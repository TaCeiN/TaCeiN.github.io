import { esc, html, toast, withLoading, loadingState, errorState } from '../app/ui.js';
import { API_BASE } from '../app/config.js';
import {
  postForm, readPostForm, postList, pollForm, readPollForm, pollList,
} from '../app/house-admin.js';

/**
 * Кабинет председателя совета дома.
 *
 * Третий уровень доступа: выше жителя, ниже УК. Ведёт объявления и опросы
 * СВОЕГО дома, к заявкам не допущен — их разбирает УК, у которой подрядчики
 * и ответственность за срок реакции.
 *
 * ОТДЕЛЬНЫЙ КЛЮЧ ТОКЕНА. Житель, диспетчер и председатель живут на одном
 * домене; с общим ключом в localStorage вход в один кабинет выкидывал бы
 * из другого. Ключи разные намеренно — так же, как у диспетчера.
 */

const TOKEN_KEY = 'zarechye-chairman-token';

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
  login: (login, password) => request('POST', '/api/chairman/login', { login, password }),
  logout: () => request('POST', '/api/chairman/logout', {}),
  me: () => request('GET', '/api/chairman/me'),
  posts: () => request('GET', '/api/chairman/posts'),
  createPost: (payload) => request('POST', '/api/chairman/posts', payload),
  removePost: (id) => request('DELETE', `/api/chairman/posts/${id}`),
  polls: () => request('GET', '/api/chairman/polls'),
  createPoll: (payload) => request('POST', '/api/chairman/polls', payload),
};

const state = {
  me: null,
  tab: 'posts',
  posts: [],
  polls: [],
};

const main = () => document.querySelector('#chrMain');

const TABS = [
  { id: 'posts', label: 'Объявления дома' },
  { id: 'polls', label: 'Опросы' },
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

function renderLogin(error) {
  return html`
    <div class="dsp-login">
      <h1>Вход для председателя</h1>
      <p>
        Логин и пароль выдаёт управляющая компания после того, как совет
        дома выбрал председателя. Жителям сюда не нужно — их приложение
        открывается по адресу сайта.
      </p>

      <div class="field-label">Логин</div>
      <input type="text" id="chrLogin" autocomplete="username">

      <div class="field-label">Пароль</div>
      <input type="password" id="chrPass" autocomplete="current-password">

      <div class="field-error ${error ? 'show' : ''}" id="chrErr">${esc(error ?? '')}</div>

      <button class="btn-primary" data-action="do-login">Войти</button>
    </div>`;
}

/**
 * Что председателю доступно, а что нет — сказано прямо на экране.
 *
 * Иначе первым же вопросом будет «а где заявки жильцов»: человек видит
 * кабинет и ожидает от него всего сразу.
 */
function scopeNote() {
  return html`
    <div class="dsp-banner wait">
      Вы ведёте дом ${esc(state.me?.houseLabel ?? '')}: объявления и опросы.
      Заявки жильцов разбирает управляющая компания — у неё подрядчики
      и сроки по регламенту.
    </div>`;
}

function renderPosts() {
  return scopeNote() + renderTabs()
    + postForm({ houseLabel: state.me?.houseLabel ?? 'ваш дом' })
    + postList(state.posts);
}

function renderPolls() {
  return scopeNote() + renderTabs() + pollForm() + pollList(state.polls);
}

async function loadSection() {
  main().innerHTML = loadingState('Загружаем…');
  try {
    if (state.tab === 'polls') {
      state.polls = (await api.polls()).polls;
      main().innerHTML = renderPolls();
      return;
    }
    state.posts = (await api.posts()).posts;
    main().innerHTML = renderPosts();
  } catch (error) {
    if (error.status === 401) return showLogin('Сессия истекла, войдите заново');
    main().innerHTML = errorState(error, 'reload');
  }
}

function showLogin(error) {
  state.me = null;
  document.querySelector('#chrWho').textContent = '';
  document.querySelector('#chrLogout').hidden = true;
  main().innerHTML = renderLogin(error);
}

async function boot() {
  if (!tokenStore.get()) return showLogin(null);

  try {
    state.me = await api.me();
  } catch {
    return showLogin(null);
  }

  document.querySelector('#chrWho').textContent = state.me.name;
  document.querySelector('#chrLogout').hidden = false;
  await loadSection();
}

async function handleAction(action, target) {
  switch (action) {
    case 'do-login': {
      const login = document.querySelector('#chrLogin')?.value.trim() ?? '';
      const password = document.querySelector('#chrPass')?.value ?? '';
      await withLoading(target, async () => {
        try {
          await api.login(login, password);
          await boot();
        } catch (error) {
          const box = document.querySelector('#chrErr');
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

    case 'tab':
      state.tab = target.dataset.v;
      return loadSection();

    case 'reload':
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

    default:
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  handleAction(target.dataset.action, target);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const button = document.querySelector('[data-action="do-login"]');
  if (button && document.querySelector('#chrPass')) handleAction('do-login', button);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
