import { api, ApiError } from './api.js';
import { platform } from './platform.js';
import { activePropertyStore } from './config.js';
import {
  $, setHtml, toast, loadingState, errorState, emptyState, formatDate, esc, html,
} from './ui.js';
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
import { renderProperty, handlePropertyAction } from './screens/property.js';
import {
  renderCouncil, renderCouncilHouse, handleCouncilAction,
} from './screens/council.js';
import {
  renderCouncilPosts, renderCouncilPostForm, handleCouncilPostsAction,
} from './screens/council-posts.js';
import {
  renderCouncilPolls, renderCouncilPollForm, handleCouncilPollsAction,
} from './screens/council-polls.js';
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
  properties: ['Моя недвижимость', false],
  property: ['Объект', false],
  'add-property': ['Добавить недвижимость', false],
  'add-receipt': ['Добавить квитанцию', false],
  emergency: ['Аварийные службы', false],
  privacy: ['Персональные данные', false],
  profile: ['Профиль', false],
  council: ['Совет дома', false],
  'council-house': ['Квартиры дома', false],
  'council-posts': ['Объявления совета', false],
  'council-post-new': ['Новое объявление', false],
  'council-polls': ['Опросы дома', false],
  'council-poll-new': ['Новый опрос', false],
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
  // Пустую подпись не показываем: у дома может не быть управляющей организации
  const sub = $('#hdSub');
  if (sub) sub.style.display = showSub && sub.innerHTML ? 'flex' : 'none';

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
  if (name === 'login' || name === 'add-property' || name === 'add-receipt') {
    const adding = name === 'add-property';

    /**
     * Квитанция к известной квартире: адрес спрашивать не нужно, и уходит
     * она другим маршрутом — там уже есть сессия и выбранный объект.
     */
    const attachTo = name === 'add-receipt' ? params.id : null;
    const attached = attachTo
      ? state.me?.properties.find((p) => p.propertyId === attachTo)
      : null;

    setHtml(pages, renderLogin({
      ...state,
      ...params,
      addingAddress: adding,
      attachTo,
      attachLabel: attached ? shortAddress(attached) : '',
    }));
    state.cleanup = bindLogin(pages, {
      attachTo,
      onSuccess: () => (name === 'login' ? boot({ silent: true }) : boot()),
      /**
       * Обновить свои данные, не уходя с экрана: после отправки или отзыва
       * заявки список объектов на сервере уже другой, и профиль не должен
       * показывать вчерашний.
       */
      refreshMe: async () => { state.me = await api.me(); },
      rerender: () => renderScreen(name, params),
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
      case 'council':
        setHtml(host, await renderCouncil(state));
        break;
      case 'council-house':
        setHtml(host, await renderCouncilHouse(state));
        break;
      case 'council-posts':
        setHtml(host, await renderCouncilPosts(state));
        break;
      case 'council-post-new':
        setHtml(host, renderCouncilPostForm());
        // Не терять набранный текст, если мини-апп случайно свернули
        platform.guardClosing(true);
        state.cleanup = () => platform.guardClosing(false);
        break;
      case 'council-polls':
        setHtml(host, await renderCouncilPolls(state));
        break;
      case 'council-poll-new':
        setHtml(host, renderCouncilPollForm());
        platform.guardClosing(true);
        state.cleanup = () => platform.guardClosing(false);
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
        setHtml(host, await renderPolls(state));
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
      case 'property':
        setHtml(host, renderProperty(state, params));
        break;
      case 'access':
        setHtml(host, await renderAccess(state));
        break;
      case 'payment':
        setHtml(host, await renderPayment(state));
        break;
      case 'emergency':
        setHtml(host, renderEmergency(state));
        break;
      case 'privacy':
        setHtml(host, renderPrivacy());
        break;

      case 'notifications':
        setHtml(host, await notificationsScreen());
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
    property: 'profile', 'add-receipt': 'profile',
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
  council: 'council',
};

async function handleAction(action, target) {
  /**
   * back здесь не роскошь: экран-форма закрывается ВОЗВРАТОМ на список,
   * а не reset-ом. reset стирает стек навигации целиком, и кнопка «Назад»
   * в шапке пропадает — человек остаётся на списке без выхода в раздел.
   */
  const ctx = { state, show: (n, p) => go(n, p), go, reset, refresh, back };

  if (await handleRequestAction(action, target, ctx)) return;
  if (await handleCouncilAction(action, target, ctx)) return;
  if (await handleCouncilPostsAction(action, target, ctx)) return;
  if (await handleCouncilPollsAction(action, target, ctx)) return;
  if (await handleMeterAction(action, target, ctx)) return;
  if (await handleHouseAction(action, target, ctx)) return;
  if (await handleProfileAction(action, target, ctx)) return;
  if (await handlePropertyAction(action, target, ctx)) return;

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

    /**
     * Отказ по запросу доступа.
     *
     * Тот же эндпоинт, что и отзыв доступа: заявка помечается отозванной
     * и уходит из списка. Без этой кнопки чужой человек, сфотографировавший
     * квитанцию, висел в запросах вечно — разрешить было можно, отказать
     * нечем.
     */
    case 'reject':
      try {
        await api.revokeAccess(target.dataset.id);
        platform.haptic('medium');
        toast('Запрос отклонён');
        state.me = await api.me();
        await refresh();
      } catch (error) {
        toast(error.message);
      }
      return;

    /** Проверка, подтвердил ли собственник доступ. Сессия уже своя. */
    case 'check-access':
      try {
        state.me = await api.me();
        /**
         * Подтверждение — это ACTIVE. Ожидающий объект приходит в список
         * сразу, поэтому проверка на длину списка отвечала бы «пустили»
         * ещё до решения председателя.
         */
        const approved = state.me.properties.find((p) => p.status === 'active');
        if (approved) {
          platform.haptic('medium');
          state.currentProperty = approved;
          activePropertyStore.set(state.me.user?.id, approved.propertyId);
          return reset('home');
        }
        toast('Председатель пока не подтвердил доступ');
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

  /**
   * Активная собственность переживает перезапуск.
   *
   * Проверяем, что объект ещё в списке: доступ могли отозвать, а заявку
   * отклонить, и тогда сохранённый выбор указывает в никуда.
   */
  const savedId = activePropertyStore.get(state.me.user?.id);
  state.currentProperty = state.me.properties.find((p) => p.propertyId === savedId)
    // Без сохранённого выбора открываем подтверждённую квартиру: на ней
    // работает всё, а ожидающая — половина разделов с объяснением
    ?? state.me.properties.find((p) => p.status === 'active')
    ?? state.me.properties[0]
    ?? null;

  /**
   * Председательство грузим вместе с профилем.
   *
   * Ошибку глотаем: раздел «Совет дома» — дополнение, и если запрос
   * не прошёл, приложение жителя обязано открыться как обычно.
   */
  state.chairman = await api.chairmanMe().catch(() => ({ isChairman: false, houses: [] }));

  /**
   * Имя управляющей организации приходит из реестра и может отсутствовать:
   * дома нет в реестре ГИС ЖКХ либо УК ещё не подтвердила адрес. Тогда
   * подпись прячется целиком — подставлять сюда «УК» или демонстрационное
   * название значит соврать жителю о том, кто его обслуживает.
   */
  const sub = $('#hdSub');
  if (sub) {
    const ukName = state.currentProperty?.ukName;
    sub.innerHTML = ukName ? `<span class="dot"></span>${esc(ukName)}` : '';
    sub.style.display = ukName ? 'flex' : 'none';
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
 * ЧТО ЗДЕСЬ ИЗМЕНИЛОСЬ. Раньше экран был заглушкой: «в браузере
 * уведомлений не будет». При этом уведомления писались в базу с самого
 * начала — просто прочитать их было негде, маршрута не существовало.
 * Для жителя из браузера это значило, что смену статуса заявки, вопрос
 * диспетчера и аварийное отключение он не узнавал никак.
 *
 * Сообщения от бота остаются главным каналом: они приходят, даже когда
 * приложение закрыто. Но список должен быть и здесь — иначе половина
 * событий продукта существует только в базе.
 */
async function notificationsScreen() {
  const inMax = platform.inMax;

  let data;
  try {
    data = await api.notifications();
  } catch (error) {
    return errorState(error, 'reload');
  }

  const channel = html`
    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      ${inMax
        ? 'Эти же события приходят сообщением от бота — даже когда приложение закрыто.'
        : `В браузере сообщения не приходят: этот канал работает только внутри MAX.
           Здесь события копятся и ждут, пока вы зайдёте.`}
    </div>`;

  if (data.notifications.length === 0) {
    return emptyState(
      'Пока ничего не было',
      'Здесь появятся смены статуса заявок, вопросы диспетчера и объявления об авариях',
    ) + channel;
  }

  // Открыли список — значит прочитали: держать счётчик непрочитанного
  // после того, как человек всё увидел, значит врать ему
  api.readNotifications().catch(() => {});

  return html`
    <div class="list">
      ${data.notifications.map((n) => html`
        <div class="row">
          <span class="sq ${n.read ? '' : 'new'}">
            <svg viewBox="0 0 20 20" fill="none"><path d="M5 8.5C5 6 6.9 4 10 4C13.1 4 15 6 15 8.5C15 11.3 16.5 12.5 16.5 12.5H3.5C3.5 12.5 5 11.3 5 8.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </span>
          <div class="content">
            <div class="t">${esc(n.title)}</div>
            <div class="d">${esc(n.body)}</div>
            <div class="d" style="font-size:12px">
              ${esc(formatDate(n.at))}${n.delivered ? ' · доставлено в чат' : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>
    ${channel}`;
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
