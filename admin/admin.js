import { esc, html, formatDate, toast, withLoading, loadingState, errorState, emptyState } from '../app/ui.js';
import { API_BASE } from '../app/config.js';

/**
 * Кабинет оператора сервиса.
 *
 * ЗАЧЕМ ОН. Дом без управляющей компании некому подключить изнутри:
 * председателя назначает УК, а её нет. Разрывает круг человек снаружи.
 * До этого кабинета он работал командами из консоли.
 *
 * ОТДЕЛЬНОЕ ХРАНИЛИЩЕ ТОКЕНА. Кабинеты и приложение жителя живут на одном
 * домене, и один ключ в localStorage они бы затирали друг другу: вход
 * оператора выкидывал бы диспетчера, а тот — жителя. Ключи разные
 * намеренно — эта грабля в проекте уже описана.
 */

const TOKEN_KEY = 'zarechye-admin-token';

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
  login: (login, password) => request('POST', '/api/admin/login', { login, password }),
  logout: () => request('POST', '/api/admin/logout', {}),
  me: () => request('GET', '/api/admin/me'),
  audit: () => request('GET', '/api/admin/audit'),

  houses: (q) => request('GET', `/api/admin/houses?q=${encodeURIComponent(q)}`),
  house: (key) => request('GET', `/api/admin/houses/${encodeURIComponent(key)}`),
  setForm: (key, form) =>
    request('POST', `/api/admin/houses/${encodeURIComponent(key)}/form`, { form }),
  connectOrg: (key, inn, form) =>
    request('POST', `/api/admin/houses/${encodeURIComponent(key)}/org`, { inn, form }),
  makeChairman: (key, userId) =>
    request('POST', `/api/admin/houses/${encodeURIComponent(key)}/chairman`, { userId }),
  revokeChairman: (id) => request('POST', `/api/admin/chairmen/${id}/revoke`, {}),

  claims: () => request('GET', '/api/admin/house-claims'),
  decideClaim: (id, status) =>
    request('POST', `/api/admin/house-claims/${id}/decide`, { status }),

  users: (q) => request('GET', `/api/admin/users?q=${encodeURIComponent(q)}`),
  user: (id) => request('GET', `/api/admin/users/${id}`),
  revokeBinding: (id, reason) =>
    request('POST', `/api/admin/bindings/${id}/revoke`, { reason }),

  orgs: (q) => request('GET', `/api/admin/orgs?q=${encodeURIComponent(q)}`),
  orgDispatcher: (id, login) =>
    request('POST', `/api/admin/orgs/${id}/dispatcher`, login ? { login } : {}),

  tables: () => request('GET', '/api/admin/tables'),
  table: (name, page, q) => request(
    'GET',
    `/api/admin/tables/${encodeURIComponent(name)}?page=${page}&q=${encodeURIComponent(q ?? '')}`,
  ),
};

/** Формы управления домом: значение и человеческое название. */
const FORMS = [
  ['uk', 'управляющая компания'],
  ['tsj', 'ТСЖ'],
  ['zhsk', 'ЖСК'],
  ['direct', 'непосредственное управление'],
  ['none', 'управления нет'],
  ['private', 'частный дом'],
  ['unknown', 'неизвестно'],
];

/* ─────────────── состояние ─────────────── */

const state = {
  me: null,
  tab: 'houses',
  /** Результат поиска домов: null — ещё не искали, [] — не нашлось */
  houses: null,
  houseQuery: '',
  /** Ключ открытого дома: карточка вместо списка */
  openHouse: null,
  users: null,
  userQuery: '',
  openUser: null,
  orgs: null,
  orgQuery: '',
  tableName: null,
  tablePage: 1,
  tableQuery: '',
};

const main = () => document.querySelector('#admMain');

/* ─────────────── экраны ─────────────── */

function renderLogin(error) {
  return html`
    <div class="dsp-login">
      <h1>Вход для оператора</h1>
      <p>
        Это рабочее место оператора сервиса. Ни жителям, ни управляющим
        компаниям сюда не нужно — у них свои адреса.
      </p>

      <div class="field-label">Логин</div>
      <input type="text" id="admLogin" autocomplete="username" placeholder="operator">

      <div class="field-label">Пароль</div>
      <input type="password" id="admPass" autocomplete="current-password">

      <div class="field-error ${error ? 'show' : ''}" id="admErr">${esc(error ?? '')}</div>

      <button class="btn-primary" data-action="do-login">Войти</button>
    </div>`;
}

const TABS = [
  { id: 'houses', label: 'Дома' },
  { id: 'claims', label: 'Заявки на подключение' },
  { id: 'users', label: 'Жители' },
  { id: 'orgs', label: 'Организации' },
  { id: 'tables', label: 'База' },
  { id: 'audit', label: 'Журнал' },
];

function tabsBar() {
  return html`
    <div class="dsp-tabs">
      ${TABS.map((t) => html`
        <button class="dsp-tab ${state.tab === t.id ? 'on' : ''}"
                data-action="tab" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('')}
    </div>`;
}

/* ─────────────── дома ─────────────── */

/**
 * Вход в раздел — поиск, а не список.
 *
 * У оператора нет точки отсчёта: диспетчер видит дома своей организации,
 * председатель — свой, а оператор ищет дом, о котором ещё ничего
 * не известно. Показывать ему «все дома» бессмысленно — их четырнадцать
 * тысяч по одной области.
 */
function housesSection(rows, q) {
  return html`
    <div class="dsp-card">
      <h2>Дома</h2>
      <div class="field-label">Адрес или его часть</div>
      <input type="text" id="admHouseQ" value="${esc(q ?? '')}"
             placeholder="Например: Ленина 85">
      <button class="btn-primary" data-action="find-houses">Найти</button>
    </div>

    ${rows === null ? '' : rows.length === 0
      ? emptyState('Ничего не нашлось', 'Проверьте написание адреса')
      : html`
        <div class="dsp-card">
          <table class="dsp-table">
            <thead><tr><th>Адрес</th><th>Управление</th><th>Жители</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r) => html`
                <tr>
                  <td>${esc(r.address)}</td>
                  <td>
                    ${esc(r.orgName ?? r.formLabel)}
                    ${r.hasChairman ? '<div class="dsp-dim">председатель есть</div>' : ''}
                    ${r.openClaims ? `<div class="dsp-dim">заявок: ${r.openClaims}</div>` : ''}
                  </td>
                  <td>${r.residents}</td>
                  <td>
                    <button class="dsp-mini" data-action="open-house"
                            data-key="${esc(r.houseKey)}">Открыть</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}`;
}

function houseCardSection(h) {
  return html`
    <div class="dsp-card">
      <button class="dsp-mini" data-action="back-houses">← К поиску</button>
      <h2>${esc(h.address)}</h2>
      <p class="dsp-dim">${esc(h.houseKey)}</p>

      <div class="field-label">Форма управления</div>
      <select data-action="set-form" data-key="${esc(h.houseKey)}">
        ${FORMS.map(([value, label]) => html`
          <option value="${esc(value)}" ${h.form === value ? 'selected' : ''}>
            ${esc(label)}
          </option>`).join('')}
      </select>
      ${h.orgName ? html`<p class="dsp-dim">Организация: ${esc(h.orgName)}</p>` : ''}
      ${h.setBy ? html`<p class="dsp-dim">Проставил: ${esc(h.setBy)}</p>` : ''}

      <div class="field-label">Подключить организацию по ИНН</div>
      <p class="dsp-dim">
        Организация и её дома тянутся из ГИС ЖКХ — это импорт, а не ручной
        ввод. Так ключ дома совпадёт с тем, что придёт из квитанции жителя.
      </p>
      <input type="text" id="admOrgInn" placeholder="10 или 12 цифр" inputmode="numeric">
      <button class="btn-primary secondary" data-action="connect-org"
              data-key="${esc(h.houseKey)}">Подключить</button>
    </div>

    <div class="dsp-card">
      <h2>Председатель</h2>
      ${h.chairman ? html`
        <p>${esc(h.chairman.name)}${h.chairman.flat ? `, кв. ${esc(h.chairman.flat)}` : ''}</p>
        <button class="dsp-mini danger" data-action="revoke-chairman"
                data-id="${esc(h.chairman.id)}">Снять с должности</button>`
        : html`
        <p class="dsp-dim">
          Председателя нет — значит подтверждать жителей в этом доме некому,
          и дом заперт. Выберите его из списка жителей ниже.
        </p>`}
    </div>

    <div class="dsp-card">
      <h2>Жители · ${h.residents.length}</h2>
      ${h.residents.length === 0
        ? '<p class="dsp-dim">В доме пока никого нет</p>'
        : html`
        <table class="dsp-table">
          <thead><tr><th>Кто</th><th>Квартира</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${h.residents.map((r) => html`
              <tr>
                <td>${esc(r.name)}<div class="dsp-dim">${r.viaMax ? 'через MAX' : 'браузер'}</div></td>
                <td>${esc(r.flat || '—')}</td>
                <td>${esc(statusLabel(r.status))}${r.role === 'owner' ? ' · собственник' : ''}</td>
                <td>
                  ${h.chairman ? '' : html`
                    <button class="dsp-mini" data-action="make-chairman"
                            data-key="${esc(h.houseKey)}" data-id="${esc(r.userId)}">
                      Назначить председателем
                    </button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>

    <div class="dsp-card">
      <h2>Обращения · ${h.requests.length}</h2>
      <p class="dsp-dim">
        Только чтение. Обращение нельзя ни удалить, ни закрыть: у жителя
        должно остаться доказательство, которое никто не сотрёт.
      </p>
      ${h.requests.length === 0
        ? '<p class="dsp-dim">Обращений нет</p>'
        : html`
        <table class="dsp-table">
          <thead><tr><th>Когда</th><th>Что</th><th>Статус</th></tr></thead>
          <tbody>
            ${h.requests.map((r) => html`
              <tr>
                <td>${esc(formatDate(r.createdAt))}</td>
                <td>${esc(r.title)}<div class="dsp-dim">${esc(r.category)}</div></td>
                <td>${esc(r.statusLabel ?? r.status)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>`;
}

function statusLabel(status) {
  return { active: 'подтверждён', pending: 'ждёт подтверждения', revoked: 'доступ закрыт' }[status]
    ?? status;
}

/* ─────────────── заявки на подключение ─────────────── */

function claimsSection(rows) {
  if (!rows.length) {
    return emptyState('Очередь пуста', 'Здесь появятся дома, которые просят подключить');
  }

  return html`
    <div class="dsp-card">
      <h2>Заявки на подключение дома</h2>
      <p class="dsp-dim">
        Житель просит подключить дом, за которым никто не стоит. Решить —
        значит разобраться с домом: проставить форму, подключить организацию
        или назначить председателя.
      </p>
      <table class="dsp-table">
        <thead><tr><th>Дом</th><th>Кто просит</th><th>Когда</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => html`
            <tr>
              <td>
                ${esc(r.houseKey)}
                <div><button class="dsp-mini" data-action="open-house"
                             data-key="${esc(r.houseKey)}">Открыть дом</button></div>
              </td>
              <td>${esc(r.userName)}${r.note ? html`<div class="dsp-dim">«${esc(r.note)}»</div>` : ''}</td>
              <td>${esc(formatDate(r.createdAt))}</td>
              <td>
                <button class="dsp-mini" data-action="decide-claim"
                        data-id="${esc(r.id)}" data-status="done">Решено</button>
                <button class="dsp-mini danger" data-action="decide-claim"
                        data-id="${esc(r.id)}" data-status="rejected">Отклонить</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ─────────────── жители ─────────────── */

function usersSection(rows, q) {
  return html`
    <div class="dsp-card">
      <h2>Жители</h2>
      <div class="field-label">Имя или телефон</div>
      <input type="text" id="admUserQ" value="${esc(q ?? '')}" placeholder="Например: Петров">
      <button class="btn-primary" data-action="find-users">Найти</button>
    </div>

    ${rows === null ? '' : rows.length === 0
      ? emptyState('Никого не нашлось', 'Проверьте написание')
      : html`
        <div class="dsp-card">
          <table class="dsp-table">
            <thead><tr><th>Кто</th><th>Телефон</th><th>Адресов</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r) => html`
                <tr>
                  <td>${esc(r.name)}<div class="dsp-dim">${r.viaMax ? 'через MAX' : 'браузер'}</div></td>
                  <td>${esc(r.phone ?? '—')}</td>
                  <td>${r.properties}</td>
                  <td><button class="dsp-mini" data-action="open-user"
                              data-id="${esc(r.id)}">Открыть</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}`;
}

function userCardSection(u) {
  return html`
    <div class="dsp-card">
      <button class="dsp-mini" data-action="back-users">← К поиску</button>
      <h2>${esc(u.name)}</h2>
      <p class="dsp-dim">
        ${u.viaMax ? 'через MAX' : 'браузер'}
        ${u.phone ? ` · ${esc(u.phone)}${u.phoneVerified ? ' (подтверждён)' : ''}` : ''}
      </p>
    </div>

    <div class="dsp-card">
      <h2>Адреса · ${u.bindings.length}</h2>
      ${u.bindings.length === 0
        ? '<p class="dsp-dim">Ни одного адреса</p>'
        : html`
        <table class="dsp-table">
          <thead><tr><th>Адрес</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${u.bindings.map((b) => html`
              <tr>
                <td>${esc(b.address)}${b.flat ? `, кв. ${esc(b.flat)}` : ''}</td>
                <td>${b.role === 'owner' ? 'собственник' : 'жилец'}</td>
                <td>
                  ${esc(statusLabel(b.status))}
                  ${b.rejectReason ? html`<div class="dsp-dim">${esc(b.rejectReason)}</div>` : ''}
                </td>
                <td>
                  ${b.status === 'revoked' ? '' : html`
                    <button class="dsp-mini danger" data-action="revoke-binding"
                            data-id="${esc(b.bindingId)}" data-owner="${b.role === 'owner'}">
                      Закрыть доступ
                    </button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>`;
}

/* ─────────────── организации ─────────────── */

function orgsSection(rows, q) {
  return html`
    <div class="dsp-card">
      <h2>Организации</h2>
      <div class="field-label">Название или ИНН</div>
      <input type="text" id="admOrgQ" value="${esc(q ?? '')}" placeholder="Например: Трианон">
      <button class="btn-primary" data-action="find-orgs">Найти</button>
    </div>

    ${rows === null ? '' : rows.length === 0
      ? emptyState('Ничего не нашлось', 'Организация появляется в базе после импорта реестра')
      : html`
        <div class="dsp-card">
          <table class="dsp-table">
            <thead><tr><th>Организация</th><th>Домов</th><th>Кабинет</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r) => html`
                <tr>
                  <td>
                    ${esc(r.name)}
                    <div class="dsp-dim">
                      ИНН ${esc(r.inn)}${r.licenseNumber ? ` · лицензия ${esc(r.licenseNumber)}` : ' · без лицензии'}
                    </div>
                  </td>
                  <td>${r.houses}</td>
                  <td>${esc(r.dispatcherLogin ?? '—')}</td>
                  <td>
                    <button class="dsp-mini" data-action="org-dispatcher"
                            data-id="${esc(r.id)}" data-login="${esc(r.dispatcherLogin ?? '')}">
                      ${r.dispatcherLogin ? 'Сбросить пароль' : 'Завести кабинет'}
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}`;
}

/* ─────────────── база ─────────────── */

function tablesSection(list, page) {
  return html`
    <div class="dsp-card">
      <h2>База</h2>
      <p class="dsp-dim">
        Только чтение. Менять данные можно действиями в разделах выше — они
        знают правила, а правка ячейки ломает их тихо. Хеши паролей
        и токены сессий здесь не показываются никогда.
      </p>
      <div class="dsp-tabs">
        ${list.map((t) => html`
          <button class="dsp-tab ${state.tableName === t.name ? 'on' : ''}"
                  data-action="open-table" data-name="${esc(t.name)}">
            ${esc(t.name)} · ${t.rows}
          </button>`).join('')}
      </div>
    </div>

    ${!page ? '' : html`
      <div class="dsp-card">
        <h2>${esc(page.name)} · ${page.total}</h2>
        <input type="text" id="admTableQ" value="${esc(state.tableQuery)}"
               placeholder="Поиск по текстовым колонкам">
        <button class="dsp-mini" data-action="search-table">Найти</button>

        <div style="overflow-x:auto">
          <table class="dsp-table">
            <thead><tr>${page.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>
              ${page.rows.map((row) => html`
                <tr>${page.columns.map((c) => `<td>${esc(cellText(row[c]))}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="dsp-dim">
          Страница ${page.page} из ${Math.max(1, Math.ceil(page.total / page.pageSize))}
        </div>
        <button class="dsp-mini" data-action="table-page" data-page="${page.page - 1}"
                ${page.page <= 1 ? 'disabled' : ''}>Назад</button>
        <button class="dsp-mini" data-action="table-page" data-page="${page.page + 1}"
                ${page.page * page.pageSize >= page.total ? 'disabled' : ''}>Вперёд</button>
      </div>`}`;
}

function cellText(value) {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* ─────────────── журнал ─────────────── */

function auditSection(rows) {
  if (!rows.length) {
    return emptyState('Журнал пуст', 'Здесь появится каждое действие оператора');
  }

  return html`
    <div class="dsp-card">
      <h2>Журнал действий</h2>
      <p class="dsp-dim">
        Каждое действие оператора, меняющее данные. Записи не удаляются
        и переживают выключение учётки.
      </p>
      <table class="dsp-table">
        <thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Над чем</th></tr></thead>
        <tbody>
          ${rows.map((r) => html`
            <tr>
              <td>${esc(formatDate(r.createdAt))}</td>
              <td>${esc(r.adminName)}</td>
              <td>${esc(r.summary)}<div class="dsp-dim">${esc(r.action)}</div></td>
              <td class="dsp-dim">${esc(r.targetKind)}: ${esc(r.targetId)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ─────────────── отрисовка ─────────────── */

async function renderTab() {
  if (state.tab === 'audit') return auditSection(await api.audit());

  if (state.tab === 'houses') {
    if (state.openHouse) return houseCardSection(await api.house(state.openHouse));
    return housesSection(state.houses, state.houseQuery);
  }

  if (state.tab === 'claims') return claimsSection(await api.claims());

  if (state.tab === 'users') {
    if (state.openUser) return userCardSection(await api.user(state.openUser));
    return usersSection(state.users, state.userQuery);
  }

  if (state.tab === 'orgs') return orgsSection(state.orgs, state.orgQuery);

  if (state.tab === 'tables') {
    const list = await api.tables();
    const page = state.tableName
      ? await api.table(state.tableName, state.tablePage, state.tableQuery)
      : null;
    return tablesSection(list, page);
  }

  return emptyState('Раздел в работе', 'Скоро здесь появится содержимое');
}

async function render() {
  if (!state.me) {
    main().innerHTML = renderLogin(null);
    document.querySelector('#admLogout').hidden = true;
    document.querySelector('#admWho').textContent = '';
    return;
  }

  document.querySelector('#admLogout').hidden = false;
  document.querySelector('#admWho').textContent = state.me.name;

  main().innerHTML = tabsBar() + loadingState('Загружаем…');
  try {
    main().innerHTML = tabsBar() + await renderTab();
  } catch (error) {
    main().innerHTML = tabsBar() + errorState(error, 'admin');
  }
}

/* ─────────────── действия ─────────────── */

async function handleAction(action, target) {
  switch (action) {
    case 'do-login': {
      const login = document.querySelector('#admLogin')?.value.trim() ?? '';
      const password = document.querySelector('#admPass')?.value ?? '';
      if (!login || !password) {
        main().innerHTML = renderLogin('Введите логин и пароль');
        return;
      }
      await withLoading(target, async () => {
        try {
          await api.login(login, password);
          state.me = await api.me();
          await render();
        } catch (error) {
          main().innerHTML = renderLogin(error.message);
        }
      });
      break;
    }

    case 'logout': {
      await api.logout().catch(() => {});
      tokenStore.set(null);
      state.me = null;
      await render();
      break;
    }

    case 'tab': {
      state.tab = target.dataset.tab;
      state.openHouse = null;
      await render();
      break;
    }

    case 'find-houses': {
      const q = document.querySelector('#admHouseQ')?.value.trim() ?? '';
      if (q.length < 2) { toast('Введите хотя бы две буквы'); return; }
      await withLoading(target, async () => {
        state.houseQuery = q;
        state.houses = await api.houses(q);
        state.openHouse = null;
        await render();
      });
      break;
    }

    case 'open-house': {
      state.tab = 'houses';
      state.openHouse = target.dataset.key;
      await render();
      break;
    }

    case 'back-houses': {
      state.openHouse = null;
      await render();
      break;
    }

    case 'set-form': {
      await api.setForm(target.dataset.key, target.value);
      toast('Форма управления изменена');
      await render();
      break;
    }

    case 'connect-org': {
      const inn = document.querySelector('#admOrgInn')?.value.trim() ?? '';
      if (!inn) { toast('Введите ИНН организации'); return; }
      await withLoading(target, async () => {
        try {
          const res = await api.connectOrg(target.dataset.key, inn, 'tsj');
          toast(`Организация подключена, домов: ${res.houses}`);
          await render();
        } catch (error) {
          toast(error.message);
        }
      });
      break;
    }

    case 'make-chairman': {
      await withLoading(target, async () => {
        try {
          const res = await api.makeChairman(target.dataset.key, target.dataset.id);
          toast(`Председатель назначен: ${res.name}`);
          await render();
        } catch (error) {
          toast(error.message);
        }
      });
      break;
    }

    case 'revoke-chairman': {
      if (!confirm('Снять председателя? Подтверждать жителей станет некому.')) return;
      await api.revokeChairman(target.dataset.id);
      toast('Председатель снят');
      await render();
      break;
    }

    case 'decide-claim': {
      await api.decideClaim(target.dataset.id, target.dataset.status);
      toast(target.dataset.status === 'done' ? 'Заявка решена' : 'Заявка отклонена');
      await render();
      break;
    }

    case 'find-users': {
      const q = document.querySelector('#admUserQ')?.value.trim() ?? '';
      if (q.length < 2) { toast('Введите хотя бы две буквы'); return; }
      await withLoading(target, async () => {
        state.userQuery = q;
        state.users = await api.users(q);
        state.openUser = null;
        await render();
      });
      break;
    }

    case 'open-user': {
      state.openUser = target.dataset.id;
      await render();
      break;
    }

    case 'back-users': {
      state.openUser = null;
      await render();
      break;
    }

    case 'revoke-binding': {
      /**
       * Причина обязательна: житель увидит её у себя на экране,
       * а «доступ закрыт, причина не указана» — то же молчание,
       * от которого продукт уходит.
       */
      const owner = target.dataset.owner === 'true';
      const warning = owner
        ? [
            'Это СОБСТВЕННИК. Квартира останется без владельца,',
            'и приглашать домочадцев станет некому.',
            '',
            'Причина закрытия доступа:',
          ].join('\n')
        : 'Причина закрытия доступа:';
      const reason = prompt(warning);
      if (reason === null) return;
      if (!reason.trim()) { toast('Без причины закрыть доступ нельзя'); return; }

      try {
        const res = await api.revokeBinding(target.dataset.id, reason);
        toast(res.wasOwner ? 'Доступ закрыт. Квартира без владельца' : 'Доступ закрыт');
        await render();
      } catch (error) {
        toast(error.message);
      }
      break;
    }

    case 'find-orgs': {
      const q = document.querySelector('#admOrgQ')?.value.trim() ?? '';
      if (q.length < 2) { toast('Введите хотя бы две буквы'); return; }
      await withLoading(target, async () => {
        state.orgQuery = q;
        state.orgs = await api.orgs(q);
        await render();
      });
      break;
    }

    case 'org-dispatcher': {
      const existing = target.dataset.login;
      const login = existing || prompt('Логин для кабинета управляющей компании:');
      if (!login) return;
      if (existing && !confirm(`Сбросить пароль кабинета ${existing}?`)) return;

      try {
        const res = await api.orgDispatcher(target.dataset.id, existing ? '' : login);
        // Пароль показывается ОДИН раз: в базе только хеш
        alert([
          `Логин: ${res.login}`,
          `Пароль: ${res.password}`,
          '',
          'Пароль показан один раз — в базе только хеш.',
        ].join('\n'));
        await render();
      } catch (error) {
        toast(error.message);
      }
      break;
    }

    case 'open-table': {
      state.tableName = target.dataset.name;
      state.tablePage = 1;
      state.tableQuery = '';
      await render();
      break;
    }

    case 'search-table': {
      state.tableQuery = document.querySelector('#admTableQ')?.value.trim() ?? '';
      state.tablePage = 1;
      await render();
      break;
    }

    case 'table-page': {
      state.tablePage = Math.max(1, Number(target.dataset.page) || 1);
      await render();
      break;
    }

    case 'retry': {
      await render();
      break;
    }

    default:
      toast('Действие не поддерживается');
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  handleAction(target.dataset.action, target);
});

/**
 * Выпадающие списки шлют `change`, а не `click`. Без этого слушателя
 * смена формы управления не срабатывала бы вовсе — та же грабля уже
 * описана в кабинете УК.
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
  if (button && document.querySelector('#admPass')) handleAction('do-login', button);
});

async function boot() {
  if (tokenStore.get()) {
    state.me = await api.me().catch(() => null);
  }
  await render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
