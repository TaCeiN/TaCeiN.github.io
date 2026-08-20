/**
 * Адрес API.
 *
 * Фронт живёт на GitHub Pages, бэкенд — отдельно, поэтому адрес вынесен
 * в один файл. Правится он без пересборки: это обычный статический файл,
 * который можно поменять прямо в репозитории перед деплоем.
 *
 * Пустая строка означает «тот же домен» — так работает локальная разработка,
 * когда наш сервер отдаёт и статику, и API.
 *
 * Для Pages сюда пишется полный адрес бэкенда, например:
 *   export const API_BASE = 'https://zarechye-api.vercel.app';
 */
export const API_BASE = '';
// Для https://tacein.github.io сюда вписывается адрес бэкенда с Vercel:
//   export const API_BASE = 'https://zarechye-api.vercel.app';

/**
 * Хранилище токена сессии.
 *
 * ПОЧЕМУ НЕ КУКА. Когда фронт на github.io, а API на другом домене, кука
 * становится сторонней: ей нужен SameSite=None, а вебвью на iOS такие куки
 * режет борьбой с трекингом. Вход начинает работать через раз, и отладить
 * это почти невозможно.
 *
 * Токен в заголовке Authorization обходит всю кухню с куками целиком:
 * одинаково работает в браузере, в вебвью и на любом домене.
 */
const TOKEN_KEY = 'zarechye-token';

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Приватный режим блокирует хранилище — останемся на куке
    }
  },
  clear() {
    this.set(null);
  },
};
