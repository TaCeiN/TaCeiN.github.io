import { platform } from './platform.js';

/**
 * Навигация по экранам.
 *
 * Стек, а не история браузера: приложение живёт на одном URL, а внутри MAX
 * адресной строки нет вовсе. Кнопку «Назад» берём нативную, если она есть, —
 * пользователь ждёт её в шапке мессенджера, а не внутри страницы.
 */

const stack = [];
let render = null;

export function initRouter(renderFn) {
  render = renderFn;

  // Аппаратная «назад» на Android и свайп в браузере не должны
  // выкидывать человека из приложения на первом же шаге
  history.replaceState({ depth: 1 }, '');
  window.addEventListener('popstate', () => {
    if (stack.length > 1) {
      back();
      history.pushState({ depth: stack.length }, '');
    }
  });

  syncBackButton();
}

export function current() {
  return stack[stack.length - 1] ?? null;
}

export function depth() {
  return stack.length;
}

/** Заменяет весь стек: переключение вкладки начинает навигацию заново. */
export async function reset(name, params = {}) {
  stack.length = 0;
  stack.push({ name, params });
  syncBackButton();
  await render(name, params);
}

export async function go(name, params = {}) {
  stack.push({ name, params });
  history.pushState({ depth: stack.length }, '');
  syncBackButton();
  await render(name, params);
}

export async function back() {
  if (stack.length <= 1) return;
  stack.pop();
  const screen = current();
  syncBackButton();
  await render(screen.name, screen.params);
}

/** Перерисовать текущий экран, не трогая стек. */
export async function refresh() {
  const screen = current();
  if (screen) await render(screen.name, screen.params);
}

function syncBackButton() {
  const visible = stack.length > 1;

  const button = document.querySelector('#hdBackBtn');
  if (button) button.style.display = visible ? 'flex' : 'none';

  // Вне MAX транспорта моста нет — дёргать его значит сорить
  // предупреждениями в консоль на каждом переходе
  if (platform.inMax) {
    if (button) button.style.display = 'none';
    if (visible) platform.backButton.show(() => back());
    else platform.backButton.hide();
  }
}
