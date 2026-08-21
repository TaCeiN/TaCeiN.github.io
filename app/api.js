import { platform } from './platform.js';
import { API_BASE, tokenStore } from './config.js';

/**
 * Клиент API.
 *
 * Три вещи, которых не было в прототипе и без которых мобильное приложение
 * разваливается в первый же день:
 *   — сообщение об ошибке, понятное человеку, а не «Failed to fetch»;
 *   — таймаут: висящий запрос хуже упавшего;
 *   — различие «нет сети» и «сервер ответил ошибкой» — лечатся они по-разному.
 */

const TIMEOUT_MS = 12000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'unknown', body = null, offline = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.offline = offline;
  }
}

async function request(method, path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = { 'Content-Type': 'application/json' };

  // Фрагмент URL на сервер не уходит — передаём подписанные параметры сами
  const initData = platform.initData;
  if (initData) headers['X-Max-Init-Data'] = initData;

  // Токен вместо куки: фронт и API живут на разных доменах
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers,
      credentials: 'same-origin',
      /**
       * Без явного запрета браузер кэширует GET эвристически — даже когда
       * сервер не просил. Человек видит начисление за прошлый месяц или
       * статус заявки, который давно изменился, и это выглядит настоящим.
       * Заголовок на сервере такой кэш не лечит: браузер до сервера
       * просто не доходит.
       */
      cache: 'no-store',
      signal: controller.signal,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error?.name === 'AbortError';

    /**
     * «Интернета нет» и «наш сервер не отвечает» — разные беды, и лечатся
     * они по-разному. Фронт лежит на GitHub Pages, а API на отдельной
     * машине: если страница открылась, интернет у человека точно есть,
     * и совет «проверьте интернет» отправляет чинить исправное.
     *
     * navigator.onLine врёт в одну сторону: false означает «сети точно нет»,
     * true — лишь «интерфейс поднят». Поэтому доверяем только false.
     */
    const offline = navigator.onLine === false;

    const message = offline
      ? 'Нет интернета. Приложение продолжит работу, когда связь вернётся.'
      : aborted
        ? 'Сервер приложения не отвечает. Скорее всего, он сейчас недоступен — попробуйте через минуту.'
        : 'Не удаётся связаться с сервером приложения. С вашим интернетом всё в порядке — недоступен наш сервер.';

    throw new ApiError(message, {
      offline: true,
      code: offline ? 'offline' : aborted ? 'timeout' : 'server_unreachable',
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    // Протухшая сессия не должна оставлять мёртвый токен в хранилище
    if (response.status === 401) tokenStore.clear();
    throw new ApiError(
      body?.message ?? 'Что-то пошло не так. Попробуйте ещё раз.',
      { status: response.status, code: body?.error ?? 'http_error', body },
    );
  }

  // Сервер отдаёт токен в теле — сохраняем его для последующих запросов
  if (body && typeof body.token === 'string') tokenStore.set(body.token);

  return body;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, payload) => request('POST', path, payload ?? {}),

  config: () => request('GET', '/api/config'),
  me: () => request('GET', '/api/me'),
  logout: async () => {
    try {
      return await request('POST', '/api/auth/logout', {});
    } finally {
      tokenStore.clear();
    }
  },

  loginMax: () => request('POST', '/api/auth/max', {}),
  loginQr: (qr) => request('POST', '/api/auth/qr', { qr }),
  loginDemo: (persAcc) => request('POST', '/api/auth/demo', { persAcc }),
  verifyPhone: (contact) => request('POST', '/api/auth/phone', contact),
  approveAccess: (bindingId) => request('POST', `/api/properties/${bindingId}/approve`, {}),
  revokeAccess: (bindingId) => request('POST', `/api/properties/${bindingId}/revoke`, {}),
  household: (propertyId) => request('GET', `/api/properties/${propertyId}/household`),

  requests: () => request('GET', '/api/requests'),
  request: (id) => request('GET', `/api/requests/${id}`),
  createRequest: (payload) => request('POST', '/api/requests', payload),
  rateRequest: (id, stars, comment) =>
    request('POST', `/api/requests/${id}/rating`, { stars, comment }),

  feed: (category) =>
    request('GET', category ? `/api/feed?category=${encodeURIComponent(category)}` : '/api/feed'),
  createPost: (payload) => request('POST', '/api/feed', payload),

  polls: () => request('GET', '/api/polls'),
  poll: (id) => request('GET', `/api/polls/${id}`),
  vote: (id, optionId) => request('POST', `/api/polls/${id}/vote`, { optionId }),

  meters: (propertyId) => request('GET', `/api/properties/${propertyId}/meters`),
  submitReading: (meterId, value, confirmed) =>
    request('POST', `/api/meters/${meterId}/readings`, { value, confirmed }),
  analytics: (propertyId) => request('GET', `/api/properties/${propertyId}/analytics`),
};
