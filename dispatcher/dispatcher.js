import { esc, html, formatDate, toast, withLoading, loadingState, errorState } from '../app/ui.js';
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
  resetChairmanPassword: (id) => request('POST', `/api/dispatcher/chairmen/${id}/password`, {}),
};

/* ─────────────── состояние ─────────────── */

const state = {
  me: null,
  tab: 'requests',
  filter: null,
  data: null,
  openId: null,
  open: null,
  houses: [],
  posts: [],
  polls: [],
  chairmen: [],
  accounts: null,
  houses: null,
  /**
   * Пароль показывается ОДИН раз, сразу после назначения или сброса.
   * В базе только хеш, второй раз его негде взять — поэтому держим его
   * в памяти вкладки до ухода с раздела, а не перезапрашиваем.
   */
  freshPassword: null,
};

const main = () => document.querySelector('#dspMain');

/* ─────────────── экраны ─────────────── */

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

        ${(r.photos ?? []).length ? html`
          <div class="dsp-card">
            <h2>Фотографии от жителя</h2>
            <div class="photo-row">
              ${r.photos.map((url) => `<img class="photo-ph" src="${esc(url)}" alt="Фото к заявке">`).join('')}
            </div>
          </div>` : ''}

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
  return renderTabs() + postForm({ houses: state.houses }) + postList(state.posts);
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
        Пароль для «${esc(fresh.name)}»: <b class="ha-secret">${esc(fresh.password)}</b> ·
        логин <b class="ha-secret">${esc(fresh.login)}</b>.
        Передайте лично: второй раз пароль не показать, в базе только хеш.
      </div>` : ''}

    <div class="dsp-card">
      <h2>Назначить председателя</h2>
      <div class="dsp-hint" style="margin-top:0">
        Председатель ведёт объявления и опросы своего дома. К заявкам
        доступа не получает — их разбирает УК.
      </div>

      <div class="field-label">Дом</div>
      <select id="chHouse" class="dsp-select">
        ${state.houses.map((h) => `<option value="${esc(h.houseKey)}">${esc(h.label)}</option>`).join('')}
      </select>

      <div class="field-label">ФИО</div>
      <input type="text" id="chName" placeholder="Например: Смирнова Анна Игоревна">

      <div class="field-label">Квартира</div>
      <input type="text" id="chFlat" placeholder="15">

      <div class="field-label">Логин для входа</div>
      <input type="text" id="chLogin" placeholder="chair-lenina-85">

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
                    логин ${esc(c.login)} · назначен ${esc(formatDate(c.createdAt))}
                    ${c.revokedAt ? ` · снят ${esc(formatDate(c.revokedAt))}` : ''}
                  </div>
                </div>
                <div class="ha-state">
                  ${c.active ? '<span class="pill ok">действует</span>' : '<span class="pill">снят</span>'}
                </div>
                ${c.active ? html`
                  <span style="display:flex;gap:8px">
                    <button class="dsp-act" data-action="ch-password" data-id="${esc(c.id)}">
                      Новый пароль
                    </button>
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
  const data = state.houses;
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
  if (state.houses.length) return;
  const data = await api.accounts();
  const byKey = new Map();
  for (const a of data.accounts) {
    if (!byKey.has(a.houseKey)) {
      // Адрес квартиры без самой квартиры — это и есть адрес дома
      byKey.set(a.houseKey, String(a.address ?? '').replace(/,\s*кв\.?\s*[^,]+$/i, ''));
    }
  }
  state.houses = [...byKey].map(([houseKey, label]) => ({ houseKey, label: label || houseKey }));
}

async function loadSection() {
  main().innerHTML = loadingState('Загружаем…');
  try {
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
      state.houses = await api.houses();
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

    case 'tab':
      state.tab = target.dataset.v;
      state.openId = null;
      state.open = null;
      state.freshPassword = null;
      return loadSection();

    case 'ha-kind': {
      target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
      target.classList.add('sel');
      const hint = document.querySelector('#haKindHint');
      if (hint) hint.textContent = target.dataset.hint ?? '';
      return;
    }

    case 'ha-publish': {
      const payload = readPostForm();
      if (!payload) {
        toast('Заполните заголовок и текст объявления');
        return;
      }
      await withLoading(target, async () => {
        try {
          const result = await api.createPost(payload);
          toast(result.notified
            ? `Опубликовано, уведомление ушло ${result.notified} жильцам`
            : 'Объявление опубликовано');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

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
        toast('Нужен вопрос и минимум два варианта ответа');
        return;
      }
      await withLoading(target, async () => {
        try {
          await api.createPoll(payload);
          toast('Опрос запущен');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'add-house': {
      const field = document.querySelector('#dspHouseAddress');
      const address = field?.value.trim() ?? '';
      if (address.length < 10) {
        toast('Укажите полный адрес дома');
        field?.focus();
        return;
      }

      await withLoading(target, async () => {
        try {
          const result = await api.addHouse(address);
          toast(result.alreadyMine ? 'Этот дом уже ваш' : 'Дом добавлен в ваш фонд');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'verify-address': {
      await withLoading(target, async () => {
        try {
          await api.verifyAddress(target.dataset.id);
          toast('Адрес подтверждён');
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'ch-add': {
      const name = document.querySelector('#chName')?.value.trim() ?? '';
      const login = document.querySelector('#chLogin')?.value.trim() ?? '';
      const houseKey = document.querySelector('#chHouse')?.value;
      const flat = document.querySelector('#chFlat')?.value.trim() ?? '';

      if (name.length < 3 || login.length < 3) {
        toast('Нужны ФИО и логин не короче трёх символов');
        return;
      }

      await withLoading(target, async () => {
        try {
          const result = await api.addChairman({ houseKey, name, login, flat });
          // Пароль показываем один раз: в базе только хеш
          state.freshPassword = { name, login: result.login, password: result.password };
          await loadSection();
        } catch (error) {
          toast(error.message);
        }
      });
      return;
    }

    case 'ch-password': {
      const row = state.chairmen.find((c) => c.id === target.dataset.id);
      await withLoading(target, async () => {
        try {
          const result = await api.resetChairmanPassword(target.dataset.id);
          state.freshPassword = {
            name: row?.name ?? 'председатель',
            login: row?.login ?? '',
            password: result.password,
          };
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
          toast('Председатель снят, вход закрыт');
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
