import {
  esc, html, formatDate, toast, withLoading, loadingState, errorState, emptyState,
} from '../app/ui.js';
import { slotText } from '../app/screens/requests.js';
import {
  postForm, readPostForm, postList, pollForm, readPollForm, pollList,
} from '../app/house-admin.js';
import { API_BASE } from '../app/config.js';

/**
 * Кабинет диспетчера УК.
 *
 * Именно он продаётся управляющей компании: очередь заявок со сроками
 * и видимой просрочкой. Приложение жителя без этого кабинета — витрина,
 * в которой статусы никто не проставляет.
 *
 * ОТДЕЛЬНОЕ ХРАНИЛИЩЕ ТОКЕНА. Кабинет и приложение жителя живут на одном
 * домене, и один ключ в localStorage они бы затирали друг другу: вход
 * диспетчера выкидывал бы жителя, и наоборот. Ключи разные намеренно.
 */

const TOKEN_KEY = 'zarechye-dispatcher-token';

const tokenStore = {
  get() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* приватный режим */ }
  },
};

/** Названия услуг: у квартиры несколько счетов, и их надо различать */
const SERVICE_LABEL = {
  housing: 'ЖКУ',
  electricity: 'свет',
  gas: 'газ',
  water: 'вода',
  heat: 'отопление',
  waste: 'мусор',
  overhaul: 'капремонт',
  other: 'прочее',
};

const STATUS_LABEL = {
  new: 'принято',
  in_work: 'в работе',
  need_info: 'нужны уточнения',
  done: 'выполнено',
  rejected: 'отклонено',
};

/** Те же переходы, что и на сервере: кнопку недопустимого не показываем. */
const TRANSITIONS = {
  new: ['in_work', 'need_info', 'rejected'],
  in_work: ['need_info', 'done', 'rejected'],
  need_info: ['in_work', 'rejected'],
  done: [],
  rejected: [],
};

/* ─────────────── сеть ─────────────── */

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, payload) {
  const token = tokenStore.get();
  const response = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).catch(() => {
    throw new ApiError('Нет связи с сервером. Проверьте подключение.', 0, null);
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401) tokenStore.set(null);
    throw new ApiError(body?.message ?? 'Ошибка запроса', response.status, body);
  }
  if (body?.token) tokenStore.set(body.token);
  return body;
}

const api = {
  login: (login, password) => request('POST', '/api/dispatcher/login', { login, password }),
  logout: () => request('POST', '/api/dispatcher/logout', {}),
  me: () => request('GET', '/api/dispatcher/me'),
  requests: (status) => request(
    'GET',
    status ? `/api/dispatcher/requests?status=${encodeURIComponent(status)}` : '/api/dispatcher/requests',
  ),
  request: (id) => request('GET', `/api/dispatcher/requests/${id}`),
  setStatus: (id, payload) => request('POST', `/api/dispatcher/requests/${id}/status`, payload),

  accounts: () => request('GET', '/api/dispatcher/accounts'),
  houses: () => request('GET', '/api/dispatcher/houses'),
  addHouse: (address) => request('POST', '/api/dispatcher/houses', { address }),
  posts: () => request('GET', '/api/dispatcher/posts'),
  createPost: (payload) => request('POST', '/api/dispatcher/posts', payload),
  removePost: (id) => request('DELETE', `/api/dispatcher/posts/${id}`),
  polls: () => request('GET', '/api/dispatcher/polls'),
  createPoll: (payload) => request('POST', '/api/dispatcher/polls', payload),

  verifyAddress: (propertyId) =>
    request('POST', `/api/dispatcher/properties/${propertyId}/verify-address`, {}),
  chairmen: () => request('GET', '/api/dispatcher/chairmen'),
  addChairman: (payload) => request('POST', '/api/dispatcher/chairmen', payload),
  revokeChairman: (id) => request('POST', `/api/dispatcher/chairmen/${id}/revoke`, {}),
  chairmanCandidates: (houseKey) =>
    request('GET', `/api/dispatcher/chairman-candidates?houseKey=${encodeURIComponent(houseKey)}`),
  // Только чтение: подтверждает председатель, не УК
  claims: () => request('GET', '/api/dispatcher/claims'),
};

/* ─────────────── состояние ─────────────── */

const state = {
  me: null,
  tab: 'requests',
  filter: null,
  data: null,
  openId: null,
  open: null,
  posts: [],
  polls: [],
  chairmen: [],
  claims: [],
  claimsNeedChairman: [],
  accounts: null,

  /**
   * ДВА РАЗНЫХ ПОЛЯ, а не одно.
   *
   * Раньше оба назывались `houses`, и ключ в этом объекте был объявлен
   * дважды — второй затирал первый, поэтому при первом заходе
   * на «Объявления» или «Председатели» `loadHouses()` падал
   * на `null.length`. Сборщик предупреждал об этом всё время
   * («Duplicate key "houses"»), но предупреждение никто не читал.
   *
   * Даже без дубля они конфликтовали по смыслу: одно поле — плоский
   * список для выпадающих меню, другое — ответ `/api/dispatcher/houses`
   * целиком, со сводкой по организации. После захода на вкладку «Дома»
   * выпадающие списки получили бы объект вместо массива.
   */
  /** Плоский список `{houseKey, label}` для выпадающих меню */
  houseOptions: [],
  /** Ответ `/api/dispatcher/houses` целиком — для вкладки «Дома» */
  housesData: null,
  /**
   * Пароль показывается ОДИН раз, сразу после назначения или сброса.
   * В базе только хеш, второй раз его негде взять — поэтому держим его
   * в памяти вкладки до ухода с раздела, а не перезапрашиваем.
   */
  freshPassword: null,
};

const main = () => document.querySelector('#dspMain');

/* ─────────────── экраны ─────────────── */


/**
 * Вложения к обращению глазами управляющей компании.
 *
 * Кабинет живёт на своём домене и со своей сессией, поэтому картинку
 * можно отдать прямо в `src`: браузер пошлёт куку сам. У жителя иначе —
 * там фронт на Pages, чужой origin, и файл он забирает запросом.
 */
function attachmentsCard(r) {
  const files = r.photos ?? [];
  if (files.length === 0) return '';

  const href = (f) => `/api/dispatcher/requests/${r.id}/files/${f.id}`;
  const isImage = (f) => String(f.mime ?? '').startsWith('image/');

  const images = files.filter(isImage).map((f) => (
    `<a href="${esc(href(f))}" target="_blank" rel="noopener">`
    + `<img class="photo-ph" src="${esc(href(f))}" alt="${esc(f.name ?? 'Вложение')}">`
    + '</a>'
  )).join('');

  const docs = files.filter((f) => !isImage(f)).map((f) => (
    `<div class="dsp-row"><a href="${esc(href(f))}" target="_blank" rel="noopener">`
    + `${esc(f.name ?? 'Документ')}</a> `
    + `<span class="dsp-dim">${Math.round((f.sizeBytes ?? 0) / 1024) || 1} КБ</span></div>`
  )).join('');

  return `<div class="dsp-card"><h2>Вложения от жителя</h2>`
    + (images ? `<div class="photo-row">${images}</div>` : '')
    + docs
    + '</div>';
}

function renderLogin(error) {
  return html`
    <div class="dsp-login">
      <h1>Вход для диспетчера</h1>
      <p>
        Это рабочее место управляющей компании. Жителям сюда не нужно —
        их приложение открывается по адресу сайта.
      </p>

      <div class="field-label">Логин</div>
      <input type="text" id="dspLogin" autocomplete="username" placeholder="dispatcher">

      <div class="field-label">Пароль</div>
      <input type="password" id="dspPass" autocomplete="current-password">

      <div class="field-error ${error ? 'show' : ''}" id="dspErr">${esc(error ?? '')}</div>

      <button class="btn-primary" data-action="do-login">Войти</button>
    </div>`;
}

const TABS = [
  { id: 'requests', label: 'Заявки' },
  { id: 'claims', label: 'Ждут председателя' },
  { id: 'posts', label: 'Объявления дома' },
  { id: 'polls', label: 'Опросы' },
  { id: 'chairmen', label: 'Председатели' },
  { id: 'accounts', label: 'Лицевые счета' },
  { id: 'houses', label: 'Мои дома' },
];

function renderTabs() {
  return html`
    <div class="dsp-tabs">
      ${TABS.map((t) => html`
        <button class="dsp-tab ${state.tab === t.id ? 'on' : ''}"
                data-action="tab" data-v="${t.id}">${esc(t.label)}</button>
      `).join('')}
    </div>`;
}

function renderQueue() {
  const { counters, requests } = state.data;

  const counter = (key, label, value, warn) => html`
    <button class="dsp-counter ${warn ? 'warn' : ''} ${state.filter === key ? 'on' : ''}"
            data-action="filter" data-v="${key ?? ''}">
      <div class="n">${value}</div>
      <div class="l">${esc(label)}</div>
    </button>`;

  return renderTabs() + html`
    <div class="dsp-counters">
      ${counter(null, 'Все заявки', counters.total, false)}
      ${counter('new', 'Новые', counters.new, false)}
      ${counter('in_work', 'В работе', counters.in_work, false)}
      ${counter('need_info', 'Ждём жителя', counters.need_info, false)}
      ${counter('__awaiting', 'Житель ответил', counters.awaiting_uk, counters.awaiting_uk > 0)}
      ${counter('__overdue', 'Просрочено', counters.overdue, counters.overdue > 0)}
    </div>

    ${requests.length === 0
      ? '<div class="dsp-empty">В этой выборке заявок нет</div>'
      : `<div class="dsp-queue">${requests.map(queueRow).join('')}</div>`}`;
}

function queueRow(r) {
  const overdue = r.sla === 'overdue';

  /**
   * Последняя реплика прямо в очереди.
   *
   * Без неё ответ жителя на уточнение виден только внутри карточки, то есть
   * фактически не виден: диспетчер не открывает подряд все заявки, а строка
   * очереди выглядит так же, как вчера.
   */
  const last = r.lastMessage;
  const sub = last
    ? `${last.actor === 'resident' ? 'Житель' : 'УК'}: ${last.text}`
    : `${r.category} · ${r.authorName ?? 'житель'}`;

  return html`
    <button class="dsp-row ${overdue ? 'overdue' : ''} ${r.awaitingUk ? 'answered' : ''}"
            data-action="open" data-id="${esc(r.id)}">
      <span class="num">№ ${esc(r.number)}</span>
      <span>
        <span class="ttl">
          ${r.awaitingUk ? '<span class="dsp-flag">ответ жителя</span>' : ''}${esc(r.title)}
        </span>
        <span class="cat">${esc(sub)}</span>
      </span>
      <span class="addr">${esc(shortAddress(r))}</span>
      <span class="pill ${statusTone(r.status)}">${esc(r.statusLabel)}</span>
      <span class="dsp-sla ${esc(r.sla)}">${esc(r.slaLabel)}</span>
    </button>`;
}

function renderDetail(r) {
  const allowed = r.allowed ?? TRANSITIONS[r.status] ?? [];

  return html`
    <a class="dsp-back" data-action="back">← К очереди</a>

    ${r.awaitingUk ? `
      <div class="dsp-banner">
        Житель ответил на уточнение — ход за УК. Ответ ниже, в переписке.
      </div>` : ''}
    ${r.awaitingResident ? `
      <div class="dsp-banner wait">
        Ждём ответа жителя на заданный вопрос. Срок реакции при этом идёт.
      </div>` : ''}

    <div class="dsp-detail">
      <div>
        <div class="dsp-card">
          <h2>Заявка № ${esc(r.number)}</h2>
          <div class="dt-title" style="margin-top:0">${esc(r.title)}</div>
          <div class="dt-p">${esc(r.description)}</div>
        </div>

        <div class="dsp-card">
          <h2>Что известно</h2>
          <dl class="dsp-kv">
            <dt>Адрес</dt><dd>${esc(r.address ?? '—')}</dd>
            <dt>Квартира</dt><dd>${esc(r.flat ?? '—')}</dd>
            <dt>Житель</dt><dd>${esc(r.authorName ?? '—')}</dd>
            <dt>Телефон</dt>
            <dd>${r.authorPhone
              ? `${esc(r.authorPhone)}${r.authorPhoneVerified ? '' : ' · не подтверждён'}`
              : 'не указан'}</dd>
            <dt>Категория</dt><dd>${esc(r.category)}</dd>
            <dt>Поступила</dt><dd>${esc(formatDate(r.createdAt))}</dd>
            <dt>Срок реакции</dt>
            <dd class="dsp-sla ${esc(r.sla)}">${esc(r.slaLabel)}</dd>
            ${r.masterSlotStart
              ? `<dt>Удобное время</dt><dd>${esc(slotText(r))}</dd>` : ''}
            ${r.assigneeName ? `<dt>Исполнитель</dt><dd>${esc(r.assigneeName)}</dd>` : ''}
            ${r.rejectReason ? `<dt>Причина отказа</dt><dd>${esc(r.rejectReason)}</dd>` : ''}
            ${r.rating ? `<dt>Оценка жителя</dt><dd>${esc(r.rating.stars)} из 5</dd>` : ''}
          </dl>
          ${r.notifiable ? '' : `
            <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
              Житель заходил из браузера, а не из MAX: сообщение от бота ему
              не уйдёт — статус он увидит, только открыв приложение.
            </div>`}
        </div>

        ${attachmentsCard(r)}

        <div class="dsp-card">
          <h2>Переписка</h2>
          <div class="timeline">
            ${(r.events ?? []).map((e) => html`
              <div class="tl-row ${e.actor === 'resident' ? 'mine' : ''}">
                <div class="tl-dot-col"><div class="tl-dot"></div><div class="tl-line"></div></div>
                <div class="tl-body">
                  <div class="tl-who">${esc(eventAuthor(e))}</div>
                  <div class="tl-t">${esc(e.text)}</div>
                  <div class="tl-time">${esc(formatDate(e.at))}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div>
        <div class="dsp-card">
          <h2>Статус — ${esc(r.statusLabel)}</h2>

          ${allowed.length === 0 ? `
            <div class="dt-p" style="margin-top:0;font-size:14px;color:var(--tx-2)">
              Заявка закрыта. Переоткрыть её нельзя — если проблема
              вернулась, житель заводит новую, и срок реакции считается заново.
            </div>` : html`
            <div class="field-label" style="margin-top:0">Сообщение жителю</div>
            <textarea id="dspComment"
              placeholder="Что сделано, что уточнить или почему отказ. Житель прочитает это в заявке"></textarea>
            <div class="dsp-hint">
              Для «Запросить уточнения» и «Отклонить» текст обязателен:
              без него житель не поймёт, чего от него ждут, и позвонит в УК.
            </div>

            <div class="field-label">Исполнитель</div>
            <input type="text" id="dspAssignee" placeholder="Например: Петров И., сантехник"
                   value="${esc(r.assigneeName ?? '')}">

            <div class="dsp-actions" style="margin-top:16px">
              ${allowed.map((to) => html`
                <button class="dsp-act ${to === 'done' ? 'primary' : ''} ${to === 'rejected' ? 'danger' : ''}"
                        data-action="set-status" data-id="${esc(r.id)}" data-to="${esc(to)}">
                  ${esc(actionLabel(to))}
                </button>`).join('')}
            </div>

            <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
              Житель увидит новый статус сразу, а если приложение открыто
              в MAX — получит сообщение от бота.
            </div>`}
        </div>
      </div>
    </div>`;
}

/**
 * Объявления дома со стороны УК.
 *
 * Раньше эндпоинты были, а кнопки не было вовсе: опубликовать отключение
 * можно было только curl-ом, то есть на практике никак.
 */
function renderPosts() {
  return renderTabs() + postForm({ houses: state.houseOptions }) + postList(state.posts);
}

function renderPolls() {
  return renderTabs() + pollForm() + pollList(state.polls);
}

/**
 * Председатели домов.
 *
 * Право подтверждает УК: в жизни председателя выбирает собрание, а учётку
 * заводит компания по протоколу. Пароль генерируется на сервере и виден
 * ровно один раз — в базе только хеш, и диспетчер не должен иметь
 * возможности войти под председателем.
 */
function renderChairmen() {
  const fresh = state.freshPassword;

  return renderTabs() + html`
    ${fresh ? html`
      <div class="dsp-banner">
        Председателем дома назначен «${esc(fresh.name)}».
        Раздел «Совет дома» появился у него в приложении — передавать
        ничего не нужно, отдельного входа и пароля больше нет.
      </div>` : ''}

    <div class="dsp-card">
      <h2>Назначить председателя</h2>
      <div class="dsp-hint" style="margin-top:0">
        Председателем становится ЖИТЕЛЬ дома: он подтверждает соседей,
        ведёт объявления и опросы, видит сводку по квартирам. К заявкам
        доступа не получает — их разбирает УК.
      </div>

      <div class="field-label">Дом</div>
      <select id="chHouse" class="dsp-select" data-action="ch-house">
        ${state.houseOptions.map((h) => `<option value="${esc(h.houseKey)}">${esc(h.label)}</option>`).join('')}
      </select>

      <div class="field-label">Кто из жителей</div>
      ${(state.chairmanCandidates ?? []).length === 0
        ? html`<div class="dsp-hint">
            По этому дому ещё никто не предъявил квитанцию. Председателя
            можно назначить, только когда в приложении появится хотя бы
            один житель этого дома.
          </div>`
        : html`<select id="chUser" class="dsp-select">
            ${state.chairmanCandidates.map((c) => `<option value="${esc(c.userId)}">${
              esc(`${c.claimedName || c.name}${c.flat ? `, кв. ${c.flat}` : ''}${
                c.status === 'active' ? '' : ' — доступ ещё не подтверждён'}`)
            }</option>`).join('')}
          </select>`}

      <div class="dsp-actions" style="margin-top:16px">
        <button class="dsp-act primary" data-action="ch-add">Назначить</button>
      </div>
    </div>

    ${state.chairmen.length === 0
      ? '<div class="dsp-empty">Председателей пока нет</div>'
      : html`
        <div class="dsp-card">
          <h2>Председатели домов</h2>
          <div class="ha-list">
            ${state.chairmen.map((c) => html`
              <div class="ha-row ${c.active ? '' : 'off'}">
                <div>
                  <div class="ha-t">${esc(c.name)}${c.flat ? `, кв. ${esc(c.flat)}` : ''}</div>
                  <div class="ha-d">
                    ${c.viaMax ? 'входит через MAX' : 'входит из браузера'}
                    ${c.phone ? ` · ${esc(c.phone)}` : ''}
                    · назначен ${esc(formatDate(c.createdAt))}
                    ${c.revokedAt ? ` · снят ${esc(formatDate(c.revokedAt))}` : ''}
                  </div>
                </div>
                <div class="ha-state">
                  ${c.active ? '<span class="pill ok">действует</span>' : '<span class="pill">снят</span>'}
                </div>
                ${c.active ? html`
                  <span style="display:flex;gap:8px">
                    <button class="dsp-act danger" data-action="ch-revoke" data-id="${esc(c.id)}">
                      Снять
                    </button>
                  </span>` : '<span></span>'}
              </div>`).join('')}
          </div>
        </div>`}`;
}

/**
 * Дома организации из реестра лицензий ГИС ЖКХ.
 *
 * Список существует до первого жителя: связка «дом → управляющая компания»
 * берётся из реестра, а не из квитанции. В квитанции указан получатель
 * платежа — энергосбыт, газовики или расчётный центр, — и управляющей
 * организацией он не является.
 */
function renderHouses() {
  const data = state.housesData;
  const org = data.organization;

  return renderTabs() + html`
    ${org ? html`
      <div class="dsp-banner wait">
        ${esc(org.name)} · ИНН ${esc(org.inn)}
        ${org.licenseNumber ? ` · лицензия ${esc(org.licenseNumber)}` : ''}
      </div>` : ''}

    <div class="dsp-counters">
      <div class="dsp-counter"><div class="n">${data.total}</div><div class="l">Домов в реестре</div></div>
      <div class="dsp-counter"><div class="n">${data.withResidents}</div><div class="l">Есть жители в приложении</div></div>
      ${org && org.houseCountByLicense !== data.total ? html`
        <div class="dsp-counter warn">
          <div class="n">${esc(org.houseCountByLicense)}</div>
          <div class="l">По данным лицензии</div>
        </div>` : ''}
    </div>

    <div class="dsp-card">
      <h2>Добавить дом вручную</h2>
      <div class="dsp-hint" style="margin-top:0">
        Реестр ГИС ЖКХ отдаёт дома не всех организаций, а смена управляющей
        компании доходит до него неделями. Если вашего дома в списке нет —
        добавьте его сами, жители сразу попадут к вам.
      </div>

      <div class="field-label">Полный адрес дома</div>
      <input type="text" id="dspHouseAddress"
             placeholder="344038, Ростовская обл, г Ростов-на-Дону, пр-кт Ленина, д. 85/3">

      <div class="dsp-actions" style="margin-top:16px">
        <button class="dsp-act primary" data-action="add-house">Добавить дом</button>
      </div>
    </div>

    ${data.houses.length === 0
      ? '<div class="dsp-empty">Домов в реестре нет. Загрузите реестр: npm run registry:import</div>'
      : html`
        <div class="dsp-card">
          <h2>Жилищный фонд</h2>
          <div class="ha-list">
            ${data.houses.map((h) => html`
              <div class="ha-row">
                <div>
                  <div class="ha-t">${esc(h.address)}</div>
                  <div class="ha-d">
                    ${h.flatCount ? `${esc(h.flatCount)} квартир` : 'число квартир неизвестно'}
                  </div>
                </div>
                <div class="ha-state">
                  ${h.linkedProperties
                    ? `<span class="pill ok">жителей: ${esc(h.linkedProperties)}</span>`
                    : '<span class="pill">никто не пришёл</span>'}
                </div>
                <span></span>
              </div>`).join('')}
          </div>
        </div>`}`;
}

/**
 * Лицевые счета дома.
 *
 * Отдельный смысл этого экрана — адреса, которые житель указал сам.
 * Так бывает, когда расчётный центр печатает QR без адреса: по одному
 * лицевому счёту дом не определить ни по одной открытой базе, поэтому
 * житель выбирает его из справочника, а сверить с биллингом может только УК.
 */
function renderAccounts() {
  const data = state.accounts;
  const unverified = data.accounts.filter((a) => a.addressSource === 'resident');

  const row = (a) => html`
    <div class="ha-row">
      <div>
        <div class="ha-t">${esc(a.address || 'адрес не указан')}</div>
        <div class="ha-d">
          ${a.accounts.length
            // Лицевых счетов у квартиры несколько: ЖКУ, свет, газ, мусор.
            // Диспетчеру нужен весь список, а не первый попавшийся номер
            ? esc(a.accounts.map((x) => `${SERVICE_LABEL[x.service] ?? 'прочее'} ${x.persAcc}`).join(' · '))
            : 'лицевых счетов нет'}
        </div>
        <div class="ha-d">
          ${a.residents.length
            ? esc(a.residents.map((r) => r.name).join(', '))
            : 'никто не зарегистрирован'}
        </div>
      </div>
      <div class="ha-state">
        ${a.addressSource === 'resident'
          ? '<span class="pill">указан жителем</span>'
          : a.addressSource === 'uk'
            ? '<span class="pill ok">сверен</span>'
            : '<span class="pill ok">из квитанции</span>'}
      </div>
      ${a.addressSource === 'resident'
        ? html`<button class="dsp-act primary" data-action="verify-address"
                       data-id="${esc(a.propertyId)}">Подтвердить адрес</button>`
        : '<span></span>'}
    </div>`;

  return renderTabs() + html`
    ${unverified.length ? html`
      <div class="dsp-banner">
        Адресов, указанных жителями и не сверенных с лицевым счётом:
        ${unverified.length}. Так бывает, когда в квитанции нет адреса —
        сверьте по своему биллингу и подтвердите.
      </div>` : ''}

    <div class="dsp-counters">
      <div class="dsp-counter"><div class="n">${data.total}</div><div class="l">Квартир и домов</div></div>
      <div class="dsp-counter"><div class="n">${data.registered}</div><div class="l">Есть житель в приложении</div></div>
      <div class="dsp-counter ${unverified.length ? 'warn' : ''}">
        <div class="n">${unverified.length}</div><div class="l">Ждут сверки адреса</div>
      </div>
    </div>

    <div class="dsp-card">
      <h2>Объекты и их лицевые счета</h2>
      <div class="ha-list">${data.accounts.map(row).join('')}</div>
    </div>`;
}

/** Кто написал: роль плюс имя — на адресе бывает несколько жильцов. */
function eventAuthor(e) {
  if (e.actor === 'system') return 'Система';
  const role = e.actor === 'dispatcher' ? 'Диспетчер' : 'Житель';
  return e.actorName ? `${role} · ${e.actorName}` : role;
}

function actionLabel(to) {
  return {
    in_work: 'Взять в работу',
    need_info: 'Запросить уточнения',
    done: 'Выполнено',
    rejected: 'Отклонить',
  }[to] ?? STATUS_LABEL[to];
}

function statusTone(status) {
  if (status === 'done') return 'ok';
  if (status === 'new') return 'new';
  if (status === 'rejected') return 'bad';
  return '';
}

/**
 * Адрес для очереди: улица, дом, квартира.
 *
 * Собирается из РАЗОБРАННЫХ полей, а не нарезкой исходной строки. Резать
 * её здесь пришлось бы теми же правилами, что в normalize.ts, вместе со
 * всеми ловушками — в том числе с тем, что  в JS не срабатывает на
 * кириллице, и «г Ростов-на-Дону» так не отфильтруешь.
 *
 * Если разбор не удался, честно показываем исходную строку целиком:
 * неполный адрес хуже длинного — по нему не найти квартиру.
 */
function shortAddress(r) {
  if (!r.street) return r.address ?? '';

  const house = [r.house, r.block ? `к${r.block}` : null].filter(Boolean).join('');
  const flat = r.flat ? `кв. ${r.flat}` : '';
  return [[capitalise(r.street), house].filter(Boolean).join(' '), flat]
    .filter(Boolean)
    .join(', ');
}

function capitalise(value) {
  return String(value).replace(/(^|[\s-])([а-яёa-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/* ─────────────── загрузка ─────────────── */

async function loadQueue() {
  main().innerHTML = loadingState('Загружаем очередь…');
  try {
    // «Просрочено» — не статус, а признак: фильтруем на клиенте
    const derived = state.filter === '__overdue' || state.filter === '__awaiting';
    const serverFilter = derived ? null : state.filter;
    const data = await api.requests(serverFilter);

    if (state.filter === '__overdue') {
      data.requests = data.requests.filter((r) => r.sla === 'overdue');
    }
    if (state.filter === '__awaiting') {
      data.requests = data.requests.filter((r) => r.awaitingUk);
    }
    state.data = data;
    main().innerHTML = renderQueue();
  } catch (error) {
    if (error.status === 401) return showLogin('Сессия истекла, войдите заново');
    main().innerHTML = errorState(error, 'reload');
  }
}

/**
 * Карточка тянется с сервера, а не берётся из строки очереди.
 *
 * В строке нет ни переписки, ни контакта жителя: пока карточка рисовалась
 * из неё, диспетчер не видел ни собственного вопроса, ни ответа на него.
 */
/**
 * Дома УК одним списком.
 *
 * Берём из лицевых счетов: отдельного справочника домов нет, а houseKey
 * нужен и для объявления, и для назначения председателя.
 */
async function loadHouses() {
  if (state.houseOptions.length) return;
  const data = await api.accounts();
  const byKey = new Map();
  for (const a of data.accounts) {
    if (!byKey.has(a.houseKey)) {
      // Адрес квартиры без самой квартиры — это и есть адрес дома
      byKey.set(a.houseKey, String(a.address ?? '').replace(/,\s*кв\.?\s*[^,]+$/i, ''));
    }
  }
  state.houseOptions = [...byKey].map(([houseKey, label]) => ({ houseKey, label: label || houseKey }));
}

/**
 * Кто в домах организации ждёт подтверждения — ТОЛЬКО ПРОСМОТР.
 *
 * ПОДТВЕРЖДАТЬ УК НЕ МОЖЕТ, и кнопок здесь нет ни одной. Диспетчер
 * заходит в кабинет хорошо если раз в месяц; сделай его звеном
 * ежедневного потока — и жители застрянут в очереди навсегда.
 * Подтверждает председатель совета дома: он живёт в этом доме
 * и знает соседей в лицо.
 *
 * Смысл этого списка ровно один: увидеть, что в доме копятся заявки,
 * а председателя нет, — и назначить его на соседней вкладке.
 */
function renderClaims() {
  const rows = state.claims ?? [];
  const needChairman = state.claimsNeedChairman ?? [];

  return renderTabs() + html`
    ${needChairman.length ? html`
      <div class="dsp-banner">
        В ${needChairman.length}
        ${needChairman.length === 1 ? 'доме' : 'домах'} люди ждут, а председателя нет —
        подтвердить их некому. Назначьте председателя на вкладке «Председатели»:
        ${esc(needChairman.map((h) => `${h.address} (${h.waiting})`).join('; '))}
      </div>` : ''}

    <div class="dsp-card">
      <h2>Кто ждёт подтверждения в ваших домах</h2>
      <div class="dt-p" style="margin-top:0;font-size:14px;color:var(--tx-2)">
        Подтверждает жителей <b>председатель совета дома</b> — он живёт
        в доме и знает соседей в лицо. Здесь список только для сведения:
        если люди копятся, а председателя нет, его нужно назначить.
      </div>

      ${rows.length === 0
        ? emptyState('Никто не ждёт', 'Здесь появятся жильцы, отсканировавшие квитанцию')
        : `<div class="ha-list">${rows.map(claimRow).join('')}</div>`}
    </div>`;
}

function claimRow(c) {
  const mismatch = c.claimedFlat && c.flat && c.claimedFlat !== c.flat;

  return html`
    <div class="ha-row ${c.complete ? '' : 'off'}">
      <div class="ha-main">
        <div class="ha-title">${esc(c.claimedName || c.accountName)}</div>
        <div class="ha-sub">${esc(c.address)}</div>
        <div class="ha-sub">
          Называет квартиру ${esc(c.claimedFlat || '—')}
          ${mismatch ? ` · в квитанции ${esc(c.flat)} — расхождение` : ''}
          ${c.claimedPhone ? ` · ${esc(c.claimedPhone)}` : ''}
        </div>
        ${c.note ? html`<div class="ha-sub">${esc(c.note)}</div>` : ''}
        <div class="ha-state">
          ${c.viaMax ? 'Вход через MAX' : 'Вход из браузера'}
          ${c.phoneVerified ? ' · телефон подтверждён' : ''}
          · ${esc(formatDate(c.requestedAt))}
        </div>
      </div>

      ${c.complete
        ? '<span class="pill">ждёт председателя</span>'
        : '<span class="pill">ждём данных о себе</span>'}
    </div>`;
}

async function loadSection() {
  main().innerHTML = loadingState('Загружаем…');
  try {
    if (state.tab === 'claims') {
      const data = await api.claims();
      state.claims = data.claims;
      state.claimsNeedChairman = data.needChairman ?? [];
      main().innerHTML = renderClaims();
      return;
    }
    if (state.tab === 'posts') {
      await loadHouses();
      state.posts = (await api.posts()).posts;
      main().innerHTML = renderPosts();
      return;
    }
    if (state.tab === 'polls') {
      state.polls = (await api.polls()).polls;
      main().innerHTML = renderPolls();
      return;
    }
    if (state.tab === 'houses') {
      state.housesData = await api.houses();
      main().innerHTML = renderHouses();
      return;
    }
    if (state.tab === 'accounts') {
      state.accounts = await api.accounts();
      main().innerHTML = renderAccounts();
      return;
    }
    if (state.tab === 'chairmen') {
      await loadHouses();
      state.chairmen = (await api.chairmen()).chairmen;
      const first = state.houseOptions[0]?.houseKey;
      state.chairmanCandidates = first
        ? (await api.chairmanCandidates(first).catch(() => ({ candidates: [] }))).candidates
        : [];
      main().innerHTML = renderChairmen();
      return;
    }
    return loadQueue();
  } catch (error) {
    if (error.status === 401) return showLogin('Сессия истекла, войдите заново');
    main().innerHTML = errorState(error, 'reload');
  }
}

async function openRequest(id) {
  state.openId = id;
  main().innerHTML = loadingState('Открываем заявку…');
  try {
    state.open = await api.request(id);
    main().innerHTML = renderDetail(state.open);
  } catch (error) {
    if (error.status === 401) return showLogin('Сессия истекла, войдите заново');
    state.openId = null;
    main().innerHTML = errorState(error, 'reload');
  }
}

function showLogin(error) {
  state.me = null;
  document.querySelector('#dspWho').textContent = '';
  document.querySelector('#dspLogout').hidden = true;
  main().innerHTML = renderLogin(error);
}

async function boot() {
  if (!tokenStore.get()) return showLogin(null);

  try {
    state.me = await api.me();
  } catch {
    return showLogin(null);
  }

  document.querySelector('#dspWho').textContent = state.me.name;
  document.querySelector('#dspLogout').hidden = false;
  await loadQueue();
}

/* ─────────────── действия ─────────────── */

async function handleAction(action, target) {
  switch (action) {
    case 'do-login': {
      const login = document.querySelector('#dspLogin')?.value.trim() ?? '';
      const password = document.querySelector('#dspPass')?.value ?? '';
      await withLoading(target, async () => {
        try {
          await api.login(login, password);
          await boot();
        } catch (error) {
          const box = document.querySelector('#dspErr');
          if (box) {
            box.textContent = error.message;
            box.classList.add('show');
          }
        }
      });
      return;
    }

    case 'logout':
      await api.logout().catch(() => {});
      tokenStore.set(null);
      return showLogin(null);

    case 'filter':
      state.filter = target.dataset.v || null;
      state.openId = null;
      return loadQueue();

    case 'open':
      return openRequest(target.dataset.id);

    case 'back':
      state.openId = null;
      state.open = null;
      return loadQueue();

    case 'reload':
      if (state.openId) return openRequest(state.openId);
      return loadSection();

    /**
     * Переключение вкладки.
     *
     * Сбрасываем открытую карточку и разовые сообщения: иначе вернувшись
     * в «Заявки», диспетчер видит карточку, из которой уже ушёл.
     */
    case 'tab': {
      state.tab = target.dataset.v;
      state.openId = null;
      state.open = null;
      state.freshPassword = null;
      await loadSection();
      return;
    }

    /* ─────────────── объявления и опросы ─────────────── */

    /** Выбор типа объявления: обычные «чипы», выделение одно на группу. */
    case 'ha-kind': {
      const group = target.parentElement;
      group?.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('sel'));
      target.classList.add('sel');

      // Подсказка меняется вместе с типом: у аварии она про рассылку
      const hint = document.querySelector('#haKindHint');
      if (hint) hint.textContent = target.dataset.hint ?? '';
      return;
    }

    case 'ha-publish': {
      const payload = readPostForm();
      if (!payload) {
        toast('Заполните заголовок и текст');
        return;
      }
      if (!payload.houseKey) {
        toast('Выберите дом');
        return;
      }

      await withLoading(target, async () => {
        try {
          const result = await api.createPost(payload);
          toast(result.notified
            ? `Опубликовано, уведомление ушло ${result.notified} жильцам`
            : 'Опубликовано');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    /**
     * Снятие объявления. Мягкое: строка остаётся в базе.
     * Жёсткое удаление лишает дом истории — «а было ли вообще объявление
     * про отключение?» станет неразрешимым спором между УК и жителями.
     */
    case 'ha-remove': {
      await withLoading(target, async () => {
        try {
          await api.removePost(target.dataset.id);
          toast('Объявление снято');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'hp-create': {
      const payload = readPollForm();
      if (!payload) {
        toast('Нужен заголовок и хотя бы два варианта, каждый с новой строки');
        return;
      }

      const houseKey = document.querySelector('#hpHouse')?.value
        ?? document.querySelector('#haHouse')?.value;
      if (!houseKey) {
        toast('Выберите дом');
        return;
      }

      await withLoading(target, async () => {
        try {
          await api.createPoll({ ...payload, houseKey });
          toast('Опрос создан');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    /* ─────────────── дома и адреса ─────────────── */

    /**
     * УК добавляет свой дом руками.
     *
     * Реестр ГИС ЖКХ отдаёт дома не всех организаций, а смена управляющей
     * компании доходит до него неделями. Без ручного ввода жители таких
     * домов остаются без УК, хотя компания уже работает в сервисе.
     */
    case 'add-house': {
      const field = document.querySelector('#dspNewHouse');
      const address = field?.value.trim() ?? '';
      if (address.length < 10) {
        toast('Нужен полный адрес с номером дома');
        field?.focus();
        return;
      }

      await withLoading(target, async () => {
        try {
          const result = await api.addHouse(address);
          toast(result.alreadyMine ? 'Этот дом уже ваш' : 'Дом добавлен');
          if (field) field.value = '';
          // Список домов для выпадающих меню устарел — пересоберём
          state.houseOptions = [];
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    /**
     * УК подтверждает адрес, который житель выбрал сам.
     *
     * Появляется, когда в квитанции адреса нет: расчётные центры печатают
     * QR без него. Сверить с лицевым счётом может только УК — у неё биллинг.
     */
    case 'verify-address': {
      await withLoading(target, async () => {
        try {
          await api.verifyAddress(target.dataset.id);
          toast('Адрес сверен');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'ch-house': {
      state.chairmanCandidates =
        (await api.chairmanCandidates(target.value).catch(() => ({ candidates: [] }))).candidates;
      main().innerHTML = renderChairmen();
      return;
    }

    case 'ch-add': {
      const houseKey = document.querySelector('#chHouse')?.value;
      const userId = document.querySelector('#chUser')?.value;

      if (!userId) {
        toast('Выберите жителя дома');
        return;
      }

      await withLoading(target, async () => {
        try {
          const result = await api.addChairman({ houseKey, userId });
          /**
           * Пароля больше нет и передавать нечего: раздел «Совет дома»
           * появляется у человека в его же приложении.
           */
          state.freshPassword = { name: result.name };
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'ch-revoke': {
      await withLoading(target, async () => {
        try {
          await api.revokeChairman(target.dataset.id);
          state.freshPassword = null;
          // Гасить нечего: права проверяются на каждом запросе
          toast('Председатель снят, права закрыты');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'set-status': {
      const to = target.dataset.to;
      const comment = document.querySelector('#dspComment')?.value.trim() ?? '';
      const assigneeName = document.querySelector('#dspAssignee')?.value.trim() ?? '';

      /**
       * Причина отклонения обязательна — так же, как на сервере.
       * Житель должен понимать, почему его заявку закрыли: «отклонено»
       * без объяснения гарантированно приводит к звонку в УК, то есть
       * ровно к тому, от чего приложение должно избавлять.
       */
      if (to === 'rejected' && !comment) {
        toast('Укажите причину отклонения — житель должен понимать, почему');
        document.querySelector('#dspComment')?.focus();
        return;
      }

      /**
       * «Нужны уточнения» без вопроса — тупик: житель видит, что от него
       * чего-то ждут, но не знает чего. До этой проверки заявка так и
       * зависала, а человек всё равно звонил в УК.
       */
      if (to === 'need_info' && !comment) {
        toast('Напишите, что уточнить — житель увидит ваш вопрос в заявке');
        document.querySelector('#dspComment')?.focus();
        return;
      }

      await withLoading(target, async () => {
        try {
          await api.setStatus(target.dataset.id, {
            status: to,
            comment: comment || undefined,
            assigneeName: assigneeName || undefined,
            rejectReason: to === 'rejected' ? comment : undefined,
          });
          toast(`Статус: ${STATUS_LABEL[to]}`);
          // Остаёмся в карточке: диспетчер обычно ведёт заявку дальше,
          // а не возвращается в очередь после каждого действия
          await openRequest(target.dataset.id);
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    default:
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  handleAction(target.dataset.action, target);
});

/**
 * Смена значения в списке — тоже действие.
 *
 * Клик по `<select>` не даёт нового значения: оно появляется только
 * в событии change. Без этого выбор дома в форме председателя не подгружал
 * бы его жителей.
 */
document.addEventListener('change', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.tagName !== 'SELECT') return;
  handleAction(target.dataset.action, target);
});

// Enter в поле пароля — обычное ожидание от формы входа
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const button = document.querySelector('[data-action="do-login"]');
  if (button && document.querySelector('#dspPass')) handleAction('do-login', button);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
