import { esc, html, formatDate, toast, withLoading, loadingState, errorState } from '../app/ui.js';
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
  setStatus: (id, payload) => request('POST', `/api/dispatcher/requests/${id}/status`, payload),
};

/* ─────────────── состояние ─────────────── */

const state = {
  me: null,
  filter: null,
  data: null,
  openId: null,
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

function renderQueue() {
  const { counters, requests } = state.data;

  const counter = (key, label, value, warn) => html`
    <button class="dsp-counter ${warn ? 'warn' : ''} ${state.filter === key ? 'on' : ''}"
            data-action="filter" data-v="${key ?? ''}">
      <div class="n">${value}</div>
      <div class="l">${esc(label)}</div>
    </button>`;

  return html`
    <div class="dsp-counters">
      ${counter(null, 'Все заявки', counters.total, false)}
      ${counter('new', 'Новые', counters.new, false)}
      ${counter('in_work', 'В работе', counters.in_work, false)}
      ${counter('need_info', 'Нужны уточнения', counters.need_info, false)}
      ${counter('__overdue', 'Просрочено', counters.overdue, counters.overdue > 0)}
    </div>

    ${requests.length === 0
      ? '<div class="dsp-empty">В этой выборке заявок нет</div>'
      : `<div class="dsp-queue">${requests.map(queueRow).join('')}</div>`}`;
}

function queueRow(r) {
  const overdue = r.sla === 'overdue';
  return html`
    <button class="dsp-row ${overdue ? 'overdue' : ''}" data-action="open" data-id="${esc(r.id)}">
      <span class="num">№ ${esc(r.number)}</span>
      <span>
        <span class="ttl">${esc(r.title)}</span>
        <span class="cat">${esc(r.category)} · ${esc(r.authorName ?? 'житель')}</span>
      </span>
      <span class="addr">${esc(shortAddress(r))}</span>
      <span class="pill ${statusTone(r.status)}">${esc(r.statusLabel)}</span>
      <span class="dsp-sla ${esc(r.sla)}">${esc(r.slaLabel)}</span>
    </button>`;
}

function renderDetail(r) {
  const allowed = TRANSITIONS[r.status] ?? [];

  return html`
    <a class="dsp-back" data-action="back">← К очереди</a>

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
            <dt>Категория</dt><dd>${esc(r.category)}</dd>
            <dt>Поступила</dt><dd>${esc(formatDate(r.createdAt))}</dd>
            <dt>Срок реакции</dt>
            <dd class="dsp-sla ${esc(r.sla)}">${esc(r.slaLabel)}</dd>
            ${r.assigneeName ? `<dt>Исполнитель</dt><dd>${esc(r.assigneeName)}</dd>` : ''}
          </dl>
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
            <div class="field-label" style="margin-top:0">Комментарий жителю</div>
            <textarea id="dspComment" placeholder="Что сделано или что нужно уточнить"></textarea>

            <div class="field-label">Исполнитель</div>
            <input type="text" id="dspAssignee" placeholder="Например: Петров И., сантехник">

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
    const serverFilter = state.filter === '__overdue' ? null : state.filter;
    const data = await api.requests(serverFilter);

    if (state.filter === '__overdue') {
      data.requests = data.requests.filter((r) => r.sla === 'overdue');
    }
    state.data = data;
    main().innerHTML = renderQueue();
  } catch (error) {
    if (error.status === 401) return showLogin('Сессия истекла, войдите заново');
    main().innerHTML = errorState(error, 'reload');
  }
}

async function openRequest(id) {
  const found = state.data?.requests.find((r) => r.id === id);
  if (!found) return loadQueue();
  state.openId = id;
  main().innerHTML = renderDetail(found);
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
      return loadQueue();

    case 'reload':
      return loadQueue();

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

      await withLoading(target, async () => {
        try {
          await api.setStatus(target.dataset.id, {
            status: to,
            comment: comment || undefined,
            assigneeName: assigneeName || undefined,
            rejectReason: to === 'rejected' ? comment : undefined,
          });
          toast(`Статус: ${STATUS_LABEL[to]}`);
          await loadQueue();
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
