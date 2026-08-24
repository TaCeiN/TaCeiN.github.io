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

/**
 * Молчаливое восстановление сессии внутри MAX.
 *
 * Сессия живёт 30 дней, и рано или поздно протухает у всех. При запуске
 * приложение и так входит заново по подписанным initData, а вот когда срок
 * вышел ПОСРЕДИ работы, человека выбрасывало на экран сканирования — хотя
 * подпись платформы приходит с каждым запросом и войти можно молча.
 *
 * Одна попытка на запрос: если и она не удалась, пусть решает экран входа.
 */
async function relogin() {
  if (!platform.initData) return false;
  try {
    const result = await request('POST', '/api/auth/max', {}, false);
    return result?.status === 'ok';
  } catch {
    return false;
  }
}

async function request(method, path, payload, allowRelogin = true) {
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
    if (response.status === 401) {
      tokenStore.clear();

      // В MAX личность подтверждена подписью — входим заново и повторяем
      if (allowRelogin && path !== '/api/auth/max' && await relogin()) {
        return request(method, path, payload, false);
      }
    }
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
  loginQr: (qr, extra) => request('POST', '/api/auth/qr', { qr, ...(extra ?? {}) }),
  /** Подсказка улиц загруженного региона: адрес выбирается, а не пишется */
  streets: (region, q) =>
    request('GET', `/api/address/streets?region=${encodeURIComponent(region)}&q=${encodeURIComponent(q)}`),
  verifyPhone: (contact) => request('POST', '/api/auth/phone', contact),
  approveAccess: (bindingId) => request('POST', `/api/properties/${bindingId}/approve`, {}),
  revokeAccess: (bindingId) => request('POST', `/api/properties/${bindingId}/revoke`, {}),
  household: (propertyId) => request('GET', `/api/properties/${propertyId}/household`),

  requests: () => request('GET', '/api/requests'),
  request: (id) => request('GET', `/api/requests/${id}`),
  createRequest: (payload) => request('POST', '/api/requests', payload),
  rateRequest: (id, stars, comment) =>
    request('POST', `/api/requests/${id}/rating`, { stars, comment }),
  commentRequest: (id, text) => request('POST', `/api/requests/${id}/comment`, { text }),

  /**
   * scope: 'house' — объявления дома (УК и председатель),
   *        'market' — доска соседей. Без scope приходит всё: так главный
   *        экран одним запросом получает и баннер аварии, и остальное.
   */
  feed: (scope) =>
    request('GET', scope ? `/api/feed?scope=${encodeURIComponent(scope)}` : '/api/feed'),
  createPost: (payload) => request('POST', '/api/feed', payload),

  polls: () => request('GET', '/api/polls'),
  poll: (id) => request('GET', `/api/polls/${id}`),
  vote: (id, optionId) => request('POST', `/api/polls/${id}/vote`, { optionId }),

  meters: (propertyId) => request('GET', `/api/properties/${propertyId}/meters`),
  submitReading: (meterId, value, confirmed) =>
    request('POST', `/api/meters/${meterId}/readings`, { value, confirmed }),
  analytics: (propertyId) => request('GET', `/api/properties/${propertyId}/analytics`),

  bills: (propertyId) => request('GET', `/api/properties/${propertyId}/bills`),
  markPaid: (billId, paid) => request('POST', `/api/bills/${billId}/paid`, { paid }),
};
