/**
 * Мелкие помощники отрисовки.
 *
 * Отдельного внимания заслуживают состояния загрузки, ошибки и пустоты:
 * в исходном прототипе их не было ни одного, а в мобильной сети они
 * встречаются в первый же день использования.
 */

const NBSP = ' ';

/**
 * Экранирование: данные приходят от людей, в том числе от соседей.
 *
 * Апостроф тоже: сейчас все атрибуты в шаблонах написаны в двойных
 * кавычках, поэтому без него обходилось, — но это правило держалось
 * на дисциплине, а не на функции. Один атрибут в одинарных кавычках,
 * и экранирование перестаёт работать молча.
 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const html = (strings, ...values) =>
  strings.reduce((out, part, i) => out + part + (i < values.length ? values[i] : ''), '');

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function setHtml(target, markup) {
  const node = typeof target === 'string' ? $(target) : target;
  if (node) node.innerHTML = markup;
  return node;
}

/**
 * Рубли из копеек. Группировку разрядов делаем сами, а не через
 * toLocaleString: результат не должен зависеть от сборки ICU в браузере.
 */
export function money(kopecks) {
  if (kopecks === null || kopecks === undefined) return '—';
  const sign = kopecks < 0 ? '-' : '';
  const abs = Math.abs(kopecks);
  const rubles = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}${rubles},${rest}${NBSP}₽`;
}

export function plural(n, one, few, many) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * День без времени: «23.08» в этом году, «23.08.2025» в прошлых.
 *
 * ГОД ПИШЕТСЯ ТОЛЬКО ТАМ, ГДЕ ОН ЧТО-ТО ЗНАЧИТ. Дата без года работает
 * ровно один год, а потом начинает обманывать молча: в журнале, в архиве
 * обращений и в ленте объявлений «15.08» перестаёт отвечать на вопрос
 * «когда». Писать год всегда — лишний шум в списке за текущий месяц,
 * поэтому правило одно на весь проект: свой год не пишем, чужой пишем.
 */
export function formatDay(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  return d.getFullYear() === new Date().getFullYear() ? day : `${day}.${d.getFullYear()}`;
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${formatDay(value)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Хвост списка: сколько показано из скольких и кнопка «Показать ещё».
 *
 * Список, обрезанный молча, человек принимает за полный — и решает, что
 * прошлогодняя жалоба пропала. Кнопка, а не страницы: это телефон,
 * и «Вперёд» здесь означает «потерял место в списке».
 *
 * Ничего не рисует, когда показано всё: строка «Показаны 12 из 12» —
 * это шум, на который человек однажды перестанет смотреть вовсе.
 */
export function moreLine({ shown, total, action }) {
  if (!total || total <= shown) return '';
  return `
    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Показаны ${shown} из ${total}
    </div>
    <button class="btn-primary secondary" data-action="${esc(action)}">Показать ещё</button>`;
}

/**
 * Перерисовать экран, не теряя места прокрутки.
 *
 * Экраны перерисовываются целиком, и без этого человек, нажавший
 * «Показать ещё» внизу списка, оказывается в его начале — то есть
 * теряет ровно то место, ради которого нажимал.
 */
export async function keepScroll(run) {
  const keep = document.querySelector('#screen')?.scrollTop ?? 0;
  await run();
  const screen = document.querySelector('#screen');
  if (screen) screen.scrollTop = keep;
}

/**
 * Кто написал реплику в переписке по обращению.
 *
 * Общий помощник для трёх читателей одной переписки — жителя, диспетчера
 * и совета дома. Раньше каждый экран считал подпись сам, и когда в
 * переписке появилась третья роль (председатель), кабинет УК не знал
 * о ней и подписывал его слова «Житель», а два места, которые всё же
 * знали, называли его по-разному. Роли мало: на адресе может быть
 * несколько жильцов, и «житель» без имени не отвечает на вопрос
 * «это писал я или мой домочадец».
 */
export function eventAuthor(e) {
  const role = eventRole(e.actor);
  if (e.actor === 'system' || !e.actorName) return role;
  return `${role} · ${e.actorName}`;
}

/**
 * Только роль, без имени — для однострочных превью в списках.
 *
 * Отдельно от `eventAuthor`, но на тех же словах: пока строка очереди
 * считала роль сама («житель или УК»), ответ председателя подписывался
 * в ней как «УК», а в карточке — правильно. Одна и та же реплика
 * называлась по-разному на соседних экранах.
 */
export function eventRole(actor) {
  if (actor === 'system') return 'Система';
  if (actor === 'dispatcher') return 'Диспетчер';
  if (actor === 'chairman') return 'Председатель совета дома';
  return 'Житель';
}

/* ─────────────── состояния экрана ─────────────── */

export function loadingState(text = 'Загружаем…') {
  return html`
    <div class="state">
      <div class="state-spinner"></div>
      <div class="state-text">${esc(text)}</div>
    </div>`;
}

/**
 * Ошибка обязана говорить, что произошло и что делать.
 * «Что-то пошло не так» без кнопки — тупик для пользователя.
 */
export function errorState(error, retryAction) {
  const offline = error?.offline;
  // Заголовок должен совпадать с диагнозом: «Нет связи» поверх текста
  // «с вашим интернетом всё в порядке» противоречит сам себе
  const title = error?.code === 'offline' ? 'Нет интернета'
    : error?.code === 'timeout' || error?.code === 'server_unreachable' ? 'Сервер недоступен'
    : 'Не удалось загрузить';
  return html`
    <div class="state">
      <div class="state-icon ${offline ? 'warn' : 'bad'}">
        ${offline
          ? '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3C7 3 3 6 1 9M12 3c5 0 9 3 11 6M12 9c-2.5 0-4.5 1.2-6 3m6-3c2.5 0 4.5 1.2 6 3M12 18v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v6M12 16.5v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'}
      </div>
      <div class="state-title">${esc(title)}</div>
      <div class="state-text">${esc(error?.message ?? 'Попробуйте ещё раз')}</div>
      ${retryAction ? `<button class="btn-primary" style="max-width:220px" data-action="${esc(retryAction)}">Повторить</button>` : ''}
    </div>`;
}

export function emptyState(title, text, action) {
  return html`
    <div class="state">
      <div class="state-icon">
        <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </div>
      <div class="state-title">${esc(title)}</div>
      ${text ? `<div class="state-text">${esc(text)}</div>` : ''}
      ${action ? `<button class="btn-primary" style="max-width:260px" data-action="${esc(action.action)}">${esc(action.label)}</button>` : ''}
    </div>`;
}

/* ─────────────── тост ─────────────── */

let toastTimer = null;

export function toast(message) {
  let node = $('#toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    node.className = 'toast';
    document.querySelector('.app')?.appendChild(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}

/* ─────────────── кнопка с индикатором ─────────────── */

export async function withLoading(button, task) {
  if (!button) return task();
  button.classList.add('loading');
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

/* ─────────────── подтверждение действия ─────────────── */

/**
 * Спросить перед необратимым действием.
 *
 * НЕ `window.confirm`: системное окно выглядит по-разному везде,
 * а в вебвью мессенджера ещё и появляется с задержкой и без наших
 * шрифтов — человек успевает решить, что приложение сломалось.
 *
 * Опасное действие стоит СЛЕВА и красным, отказ — справа и обычной
 * кнопкой: палец сам тянется к правому краю, и промах должен приводить
 * к «оставить как есть», а не к выходу из приложения.
 */
export function confirmAction({ title, text = '', confirmLabel = 'Продолжить', danger = false }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.className = 'confirm-host';
    host.innerHTML = html`
      <div class="confirm-backdrop"></div>
      <div class="confirm-box" role="dialog" aria-modal="true">
        <div class="confirm-title">${esc(title)}</div>
        ${text ? html`<div class="confirm-text">${esc(text)}</div>` : ''}
        <div class="confirm-row">
          <button type="button" class="confirm-yes ${danger ? 'danger' : ''}">${esc(confirmLabel)}</button>
          <button type="button" class="confirm-no">Отмена</button>
        </div>
      </div>`;

    const done = (answer) => {
      host.remove();
      document.body.classList.remove('dp-locked');
      resolve(answer);
    };

    host.querySelector('.confirm-yes').addEventListener('click', () => done(true));
    host.querySelector('.confirm-no').addEventListener('click', () => done(false));
    host.querySelector('.confirm-backdrop').addEventListener('click', () => done(false));

    document.body.appendChild(host);
    document.body.classList.add('dp-locked');
    host.querySelector('.confirm-no').focus();
  });
}
