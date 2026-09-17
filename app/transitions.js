/**
 * Смена экранов с переходом.
 *
 * ЗАЧЕМ. Экран раньше не сменялся, а стирался: `renderScreen` целиком
 * перезаписывал `#pages`, и старый экран исчезал в тот же кадр, когда
 * появлялся новый. Классы перехода `.page.enter-*` и `.page.leave-*`
 * лежали в styles.css и были мертвы — написаны под «два экрана сразу»,
 * а второго экрана не бывало. Спека —
 * docs/superpowers/specs/2026-09-15-screen-transitions-design.md.
 *
 * ЧТО ЗДЕСЬ. Только DOM и время: вставить входящий экран, дождаться
 * данных, сыграть переход, убрать уходящий. Какой экран рисовать и что
 * в нём показать, решает main.js — этот модуль про экраны не знает.
 *
 * ПОРЯДОК В DOM. Входящий экран вставляется ПЕРЕД уходящим. Код проекта
 * ищет элементы по id через document — `#screen`, поля форм, — около
 * пятидесяти мест, и `querySelector` отдаёт первый в порядке документа.
 * Наложение задают классы (z-index), а не порядок.
 */

/** Сколько ждать данных, прежде чем впустить заглушку «Загружаем…». */
export const WAIT_MS = 250;

/** Пары классов «вход / уход» по виду перехода. Сами правила — в styles.css. */
const CLASSES = {
  forward: ['enter-fwd', 'leave-fwd'],
  back: ['enter-back', 'leave-back'],
  fade: ['enter-fade', 'leave-fade'],
};

/** Номер последней смены экрана: ответы устаревших смен молча гаснут. */
let latest = 0;

/**
 * Самая длинная длительность перехода элемента, мс.
 *
 * Берём из вычисленного стиля, а не константой: у `classic` .22s,
 * у `new` .32s, при «уменьшить движение» — .01ms. Таймер-страховка
 * должен совпадать с тем, что реально играет.
 */
function transitionMs(el) {
  const parts = getComputedStyle(el).transitionDuration.split(',');
  return Math.max(0, ...parts.map((raw) => {
    const value = raw.trim();
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return 0;
    return value.endsWith('ms') ? n : n * 1000;
  }));
}

/**
 * Начать смену экрана.
 *
 * Сразу, до прихода данных:
 * - удаляются экраны, оставшиеся от прежних смен (уходящие и так и
 *   не показанные);
 * - текущий экран теряет id и получает `inert`. Именно сейчас, а не при
 *   старте перехода: иначе второе нажатие за время ожидания проходит,
 *   `go` кладёт тот же экран в стек дважды, и «Назад» приходится жать
 *   два раза;
 * - входящий экран вставляется невидимым (у `.page` без `.active`
 *   visibility:hidden).
 *
 * Переход стартует по `show()` или сам через WAIT_MS — что раньше.
 *
 * @param {HTMLElement} pages контейнер #pages
 * @param {{ kind: 'forward'|'back'|'fade'|'none', element?: HTMLElement }} options
 *   element — готовый корневой `.page` (экраны входа приносят свой);
 *   без него создаётся `<div class="page" id="screen">`
 */
export function startScreen(pages, { kind, element }) {
  const token = ++latest;

  for (const node of [...pages.children]) {
    if (node.classList.contains('page') && !node.classList.contains('active')) node.remove();
  }

  const old = pages.querySelector('.page.active');
  if (old) {
    old.removeAttribute('id');
    old.inert = true;
  }

  const page = element ?? document.createElement('div');
  if (element) {
    page.classList.remove('active');
  } else {
    page.className = 'page';
    page.id = 'screen';
  }
  pages.prepend(page);

  let shown = false;
  const timer = setTimeout(() => show(), WAIT_MS);

  function show() {
    if (shown || token !== latest) return;
    shown = true;
    clearTimeout(timer);

    const pair = CLASSES[kind];
    if (!old || !pair) {
      page.classList.add('active');
      old?.remove();
      return;
    }

    const [enter, leave] = pair;
    page.classList.add(enter);
    // Зафиксировать стартовое положение: без чтения раскладки браузер
    // склеит обе смены классов в одну, и переход не сыграет
    void page.offsetWidth;
    page.classList.remove(enter);
    page.classList.add('active');
    old.classList.remove('active');
    old.classList.add(leave);

    let removed = false;
    const finish = () => {
      if (removed) return;
      removed = true;
      old.remove();
    };
    old.addEventListener('transitionend', (event) => {
      if (event.target === old) finish();
    });
    // Страховка: transitionend не приходит, если переход не сыграл
    setTimeout(finish, transitionMs(old) + 100);
  }

  return {
    page,
    show,
    get shown() { return shown; },
    get stale() { return token !== latest; },
  };
}

/**
 * Данные опоздали: экран уже въехал заглушкой, и содержимое проявляется
 * на месте, а не подменяется мгновенно.
 */
export function revealLate(page) {
  page.classList.remove('late-in');
  void page.offsetWidth;
  page.classList.add('late-in');
}
