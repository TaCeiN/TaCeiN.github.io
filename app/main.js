import { api, ApiError } from './api.js';
import { platform } from './platform.js';
import { $, setHtml, toast, loadingState, errorState } from './ui.js';
import { renderLogin, bindLogin, tryMaxLogin } from './screens/login.js';
import { renderHome, homeSkeleton, shortAddress } from './screens/home.js';

/**
 * Оболочка приложения: загрузка, маршрутизация, тема.
 *
 * Экран входа и остальное приложение разделены намеренно: пока адрес
 * не подтверждён, нижняя навигация не показывается — иначе онбординг
 * можно было бы просто обойти тапом по вкладке.
 */

const state = {
  config: null,
  me: null,
  currentProperty: null,
  screen: 'boot',
  cleanup: null,
};

/* ─────────────── тема ─────────────── */

const THEME_KEY = 'zarechye-theme';

function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try { localStorage.setItem(THEME_KEY, mode); } catch { /* приватный режим */ }

  const effective = mode === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : mode;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', effective === 'light' ? '#FFFFFF' : '#1E1F24');
}

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

/* ─────────────── маршрутизация ─────────────── */

const TITLES = {
  home: ['Заречье. Дом', true],
  login: ['Заречье. Дом', false],
  requests: ['Мои обращения', false],
};

function setHeader(screen) {
  const [title, showSub] = TITLES[screen] ?? ['Заречье. Дом', false];
  const titleNode = $('#hdTitle');
  if (titleNode) titleNode.textContent = title;
  const sub = $('#hdSub');
  if (sub) sub.style.display = showSub ? 'flex' : 'none';

  const app = $('.app');
  app?.classList.toggle('onboarding', screen === 'login');
}

async function show(screen, options = {}) {
  state.cleanup?.();
  state.cleanup = null;
  state.screen = screen;
  setHeader(screen);

  const pages = $('#pages');

  if (screen === 'login') {
    setHtml(pages, renderLogin({ ...state, ...options }));
    state.cleanup = bindLogin(pages, {
      onSuccess: () => boot({ silent: true }),
      rerender: () => show('login', options),
    });
    return;
  }

  if (screen === 'home') {
    setHtml(pages, homeSkeleton());
    const markup = await renderHome(state);
    setHtml($('#page-home'), markup);
    return;
  }

  // Остальные экраны подключаются следующим шагом
  setHtml(pages, `<div class="page active">${loadingState('Экран в разработке')}</div>`);
}

/* ─────────────── действия ─────────────── */

async function handleAction(action, target) {
  switch (action) {
    case 'reload':
      return boot();

    case 'logout':
      await api.logout().catch(() => {});
      state.me = null;
      state.currentProperty = null;
      return show('login');

    case 'approve': {
      try {
        await api.approveAccess(target.dataset.id);
        toast('Доступ выдан');
        platform.haptic('medium');
        await boot({ silent: true });
      } catch (error) {
        toast(error.message);
      }
      return;
    }

    case 'pay':
      // Оплата выносится наружу: показываем реквизиты из квитанции,
      // платёж уходит в банковское приложение
      toast('Оплата по QR из квитанции — следующий шаг');
      return;

    default:
      toast('Раздел в разработке');
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
      return show('login', { name: platform.unsafeName });
    }
  }

  try {
    state.me = await api.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return show('login', { name: platform.unsafeName });
    }
    setHtml(pages, `<div class="page active">${errorState(error, 'reload')}</div>`);
    return;
  }

  state.currentProperty = state.me.properties[0] ?? null;

  const sub = $('#hdSub');
  if (sub && state.currentProperty) {
    sub.innerHTML = `<span class="dot"></span>${state.currentProperty.ukName ?? 'УК'}`;
  }

  await show('home');
}

function start() {
  applyTheme(readTheme());
  trackViewport();

  matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => applyTheme(readTheme()));

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  document.querySelectorAll('.apptab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.apptab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const screen = tab.dataset.tab;
      if (screen === 'home') show('home');
      else show(screen);
    });
  });

  boot();
}

document.addEventListener('DOMContentLoaded', start);
