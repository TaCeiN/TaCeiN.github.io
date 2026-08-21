import { api, ApiError } from './api.js';
import { platform } from './platform.js';
import { $, setHtml, toast, loadingState, errorState } from './ui.js';
import { initRouter, reset, go, back, refresh, current } from './router.js';
import { renderLogin, bindLogin, tryMaxLogin } from './screens/login.js';
import { renderHome, homeSkeleton, shortAddress } from './screens/home.js';
import {
  renderRequests, renderRequestDetail, renderComplaintForm, renderSuccess,
  handleRequestAction,
} from './screens/requests.js';
import { renderMeters, renderAnalytics, handleMeterAction } from './screens/meters.js';
import {
  renderFeed, renderPost, renderPostForm, renderPolls, renderPoll, handleHouseAction,
} from './screens/house.js';
import {
  renderProfile, renderProperties, renderAccess, renderPayment, renderEmergency,
  renderPrivacy, handleProfileAction,
} from './screens/profile.js';
import { readTheme, applyTheme } from './theme.js';

/**
 * Оболочка приложения: загрузка, экраны, тема.
 *
 * Экран входа отделён от остального: пока адрес не подтверждён, нижняя
 * навигация не показывается — иначе онбординг обходится тапом по вкладке.
 */

const state = {
  config: null,
  me: null,
  currentProperty: null,
  cleanup: null,
};

const TITLES = {
  login: ['Заречье. Дом', false],
  home: ['Заречье. Дом', true],
  requests: ['Мои обращения', false],
  request: ['Обращение', false],
  complaint: ['Новое обращение', false],
  master: ['Вызов мастера', false],
  'request-success': ['Готово', false],
  feed: ['Объявления дома', false],
  market: ['Соседи предлагают', false],
  post: ['Объявление', false],
  'new-post': ['Новое объявление', false],
  polls: ['Опросы дома', false],
  poll: ['Опрос', false],
  meters: ['Показания счётчиков', false],
  analytics: ['Аналитика потребления', false],
  payment: ['Оплата ЖКУ', false],
  access: ['Доступ к адресу', false],
  properties: ['Мои адреса', false],
  'add-property': ['Добавить адрес', false],
  emergency: ['Аварийные службы', false],
  privacy: ['Персональные данные', false],
  profile: ['Профиль', false],
};

/* ─────────────── высота под клавиатуру ─────────────── */

function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = () => document.documentElement.style
    .setProperty('--app-h', `${Math.round(vv.height)}px`);
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}

/* ─────────────── отрисовка экранов ─────────────── */

async function renderScreen(name, params = {}) {
  state.cleanup?.();
  state.cleanup = null;

  const [title, showSub] = TITLES[name] ?? ['Заречье. Дом', false];
  const titleNode = $('#hdTitle');
  if (titleNode) titleNode.textContent = params.title ?? title;
  const sub = $('#hdSub');
  if (sub) sub.style.display = showSub ? 'flex' : 'none';

  $('.app')?.classList.toggle('onboarding', name === 'login');
  syncTabs(name);

  const pages = $('#pages');

  /**
   * Вход и добавление адреса — один и тот же экран сканера, отличаются
   * только подписями и тем, что после добавления мы уже вошли.
   *
   * Рисуем его прямо в контейнер страниц, а не внутрь #screen: у .page
   * абсолютное позиционирование, и вложенная страница получила бы вторую
   * полосу прокрутки и двойные поля.
   */
  if (name === 'login' || name === 'add-property') {
    const adding = name === 'add-property';
    setHtml(pages, renderLogin({ ...state, ...params, addingAddress: adding }));
    state.cleanup = bindLogin(pages, {
      onSuccess: () => (adding ? boot() : boot({ silent: true })),
    });
    return;
  }

  // Сначала каркас, потом данные: пустой экран во время загрузки
  // выглядит как зависание
  setHtml(pages, `<div class="page active" id="screen">${loadingState()}</div>`);
  const host = $('#screen');

  try {
    switch (name) {
      case 'home':
        setHtml(host, homeSkeleton());
        setHtml(host, await renderHome(state));
        break;
      case 'requests':
        setHtml(host, await renderRequests());
        break;
      case 'request':
        setHtml(host, await renderRequestDetail(params.id));
        break;
      case 'complaint':
      case 'master':
        setHtml(host, renderComplaintForm(state, name === 'master' ? 'master' : 'complaint'));
        // Не терять заполненную форму при случайном закрытии мини-аппа
        platform.guardClosing(true);
        state.cleanup = () => platform.guardClosing(false);
        break;
      case 'request-success':
        setHtml(host, renderSuccess(params));
        break;

      case 'meters':
        setHtml(host, await renderMeters(state));
        break;
      case 'analytics':
        setHtml(host, await renderAnalytics(state));
        break;

      case 'feed':
        setHtml(host, await renderFeed(state));
        break;
      case 'market':
        setHtml(host, await renderFeed(state, { category: 'market' }));
        break;
      case 'post':
        setHtml(host, await renderPost(state, params));
        break;
      case 'new-post':
        setHtml(host, renderPostForm());
        platform.guardClosing(true);
        state.cleanup = () => platform.guardClosing(false);
        break;
      case 'polls':
        setHtml(host, await renderPolls());
        break;
      case 'poll':
        setHtml(host, await renderPoll(state, params));
        break;

      case 'profile':
        setHtml(host, renderProfile(state));
        break;
      case 'properties':
        setHtml(host, renderProperties(state));
        break;
      case 'access':
        setHtml(host, await renderAccess(state));
        break;
      case 'payment':
        setHtml(host, renderPayment(state));
        break;
      case 'emergency':
        setHtml(host, renderEmergency(state));
        break;
      case 'privacy':
        setHtml(host, renderPrivacy());
        break;

      case 'notifications':
        setHtml(host, notificationsScreen());
        break;

      default:
        setHtml(host, `<div class="state">
          <div class="state-title">Раздел в разработке</div>
          <div class="state-text">Скоро появится</div>
        </div>`);
    }
  } catch (error) {
    /**
     * Протухшая сессия — не ошибка загрузки, а повод войти заново.
     * Показывать «Не удалось загрузить» в этом случае значит запереть
     * человека в тупике: кнопка «Повторить» даст тот же 401.
     */
    if (error instanceof ApiError && error.status === 401) {
      state.me = null;
      state.currentProperty = null;
      await reset('login', { name: platform.unsafeName });
      return;
    }
    setHtml(host, errorState(error, 'reload'));
  }
}

function syncTabs(name) {
  const tabFor = {
    home: 'home',
    requests: 'requests', request: 'requests', complaint: 'requests',
    master: 'requests', 'request-success': 'requests',
    feed: 'feed', market: 'feed', post: 'feed', 'new-post': 'feed',
    polls: 'feed', poll: 'feed',
    profile: 'profile', properties: 'profile', access: 'profile',
    privacy: 'profile', 'add-property': 'profile',
  };
  const active = tabFor[name];
  document.querySelectorAll('.apptab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === active);
  });
}

/* ─────────────── действия ─────────────── */

const NAVIGATE = {
  home: 'home', requests: 'requests', complaint: 'complaint', master: 'master',
  feed: 'feed', profile: 'profile', meters: 'meters', analytics: 'analytics',
  polls: 'polls', market: 'market', payment: 'payment', access: 'access',
  emergency: 'emergency', properties: 'properties', notifications: 'notifications',
};

async function handleAction(action, target) {
  const ctx = { state, show: (n, p) => go(n, p), reset, refresh };

  if (await handleRequestAction(action, target, ctx)) return;
  if (await handleMeterAction(action, target, ctx)) return;
  if (await handleHouseAction(action, target, ctx)) return;
  if (await handleProfileAction(action, target, ctx)) return;

  switch (action) {
    case 'back':
      return back();

    case 'reload':
      return boot();

    case 'request':
      return go('request', { id: target.dataset.id });

    case 'request-success':
      return reset('requests');

    case 'logout':
      await api.logout().catch(() => {});
      state.me = null;
      state.currentProperty = null;
      return reset('login');

    case 'approve':
      try {
        await api.approveAccess(target.dataset.id);
        platform.haptic('medium');
        toast('Доступ выдан');
        state.me = await api.me();
        await refresh();
      } catch (error) {
        toast(error.message);
      }
      return;

    case 'pay':
      return go('payment');

    default:
      if (NAVIGATE[action]) return go(NAVIGATE[action]);
  }
}

/* ─────────────── запуск ─────────────── */

export async function boot({ silent = false } = {}) {
  const pages = $('#pages');
  if (!silent) setHtml(pages, `<div class="page active">${loadingState()}</div>`);

  try {
    state.config = await api.config();
  } catch (error) {
    setHtml(pages, `<div class="page active">${errorState(error, 'reload')}</div>`);
    return;
  }

  // Внутри MAX человек с привязанным счётом входит без квитанции
  if (platform.inMax && !state.me) {
    const status = await tryMaxLogin();
    if (status === 'needs_receipt') {
      return reset('login', { name: platform.unsafeName });
    }
  }

  try {
    state.me = await api.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return reset('login', { name: platform.unsafeName });
    }
    setHtml(pages, `<div class="page active">${errorState(error, 'reload')}</div>`);
    return;
  }

  state.currentProperty = state.me.properties[0] ?? null;

  const sub = $('#hdSub');
  if (sub && state.currentProperty) {
    sub.innerHTML = `<span class="dot"></span>${state.currentProperty.ukName ?? 'УК'}`;
  }

  /**
   * Тихая перезагрузка нужна там, где данные обновились, а экран менять
   * не надо — например после выдачи доступа домочадцу. Но с экрана входа
   * уходить обязательно: иначе успешный вход перерисовывает форму входа,
   * и человек остаётся на ней с уже работающей сессией.
   */
  const screen = current();
  if (silent && screen && screen.name !== 'login') return refresh();
  return reset('home');
}

/**
 * Уведомления.
 *
 * Пуш-уведомлений у веб-версии нет и быть не может: приложение открывается
 * в вебвью мессенджера, где Web Push недоступен. Единственный работающий
 * канал — сообщение от бота в MAX, и об этом честно сказано здесь, а не
 * молчаливым пустым списком.
 */
function notificationsScreen() {
  const inMax = platform.inMax;
  return `<div class="state">
    <div class="state-icon">
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 10C6 6.7 8.4 4 12 4C15.6 4 18 6.7 18 10C18 13.5 20 15 20 16H4C4 15 6 13.5 6 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 19C10 20 10.9 20.8 12 20.8C13.1 20.8 14 20 14 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </div>
    <div class="state-title">${inMax ? 'Уведомления приходят в чат' : 'Здесь уведомлений не будет'}</div>
    <div class="state-text">
      ${inMax
        ? 'Смена статуса заявки, отключения воды и напоминание о показаниях приходят сообщением от бота.'
        : 'В браузере уведомления недоступны. Откройте приложение в MAX — тогда статусы заявок будут приходить сообщением от бота.'}
    </div>
  </div>`;
}

function start() {
  applyTheme(readTheme());
  trackViewport();
  initRouter(renderScreen);

  matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => applyTheme(readTheme()));

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  document.querySelectorAll('.apptab').forEach((tab) => {
    tab.addEventListener('click', () => reset(tab.dataset.tab));
  });

  boot();
}

/**
 * Модули выполняются с отложенной загрузкой, и обычно DOMContentLoaded
 * ждёт их. Но если граф модулей вычислился позже — при восстановлении
 * страницы из кэша, при динамическом импорте — событие уже прошло,
 * обработчик не сработает, и приложение молча не запустится:
 * файлы загружены, а API не вызывается ни разу.
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
