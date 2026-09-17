import { esc, html } from '../ui.js';
import { platform } from '../platform.js';

/**
 * «Вызов мастера»: найти мастера на Авито или в Яндекс Услугах.
 *
 * Своих мастеров и договоров с сервисами нет, а ремонт внутри квартиры
 * управляющая компания не делает. Приложение сокращает путь: житель
 * выбирает проблему — мы открываем поиск с готовым запросом.
 *
 * ГЛАВНОЕ ЗДЕСЬ — РАЗВИЛКА. Течь, засор, свет бывают и в общем имуществе
 * (стояк, щиток на площадке), а это обязанность УК, бесплатно. Без вопроса
 * «Где?» приложение отправило бы человека платить за то, что ему положено.
 *
 * Спека: docs/superpowers/specs/2026-09-18-master-search-and-post-contacts-design.md
 */

/**
 * Проблемы. `query` — то, что ищет человек на Авито, а не название
 * категории: «сантехник ремонт смесителя» даёт мастеров, «сантехника» —
 * товары. `common` — бывает в общем имуществе, нужен вопрос «Где?».
 */
const GROUPS = [
  {
    title: 'Сантехника',
    items: [
      { id: 'tap', label: 'Течёт кран или смеситель', query: 'сантехник ремонт смесителя', common: true, category: 'Сантехника' },
      { id: 'clog', label: 'Засор раковины, ванны, унитаза', query: 'сантехник прочистка засора', common: true, category: 'Сантехника' },
      { id: 'toilet', label: 'Течёт унитаз или бачок', query: 'сантехник ремонт унитаза бачка' },
      { id: 'washer', label: 'Подключить стиральную машину', query: 'подключение стиральной машины' },
    ],
  },
  {
    title: 'Электрика',
    items: [
      { id: 'socket', label: 'Не работает розетка или выключатель', query: 'электрик замена розетки выключателя' },
      { id: 'breaker', label: 'Выбивает автомат, нет света', query: 'электрик выбивает автомат', common: true, category: 'Электрика' },
      { id: 'lamp', label: 'Повесить люстру или светильник', query: 'электрик установка люстры' },
    ],
  },
  {
    title: 'Двери, окна, мебель',
    items: [
      { id: 'lock', label: 'Сломался замок', query: 'замена замка входной двери' },
      { id: 'window', label: 'Не закрывается окно', query: 'ремонт пластиковых окон регулировка' },
      { id: 'furniture', label: 'Собрать мебель', query: 'сборка мебели' },
    ],
  },
  {
    title: 'Техника',
    items: [
      { id: 'washer-fix', label: 'Сломалась стиральная машина', query: 'ремонт стиральных машин' },
      { id: 'fridge', label: 'Сломался холодильник', query: 'ремонт холодильников' },
      { id: 'boiler', label: 'Не греет водонагреватель', query: 'ремонт водонагревателя бойлера' },
    ],
  },
];

const ITEMS = new Map(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i])));

/**
 * Адрес города на Авито. Только крупные города области — для остальных
 * пунктов поиск по всей области: неверный адрес города у Авито хуже,
 * чем чуть более широкий поиск.
 */
const AVITO_CITIES = {
  'ростов-на-дону': 'rostov-na-donu',
  'таганрог': 'taganrog',
  'шахты': 'shahty',
  'новочеркасск': 'novocherkassk',
  'волгодонск': 'volgodonsk',
  'батайск': 'bataysk',
  'азов': 'azov',
};

/** Текущий шаг экрана: список → «Где?» → поиск */
let step = { name: 'list' };

function cityOf(address) {
  return /(?:^|,\s*)г\.?\s+([^,]+)/i.exec(address ?? '')?.[1]?.trim() ?? null;
}

function avitoRegion(address) {
  const city = cityOf(address)?.toLowerCase().replace(/ё/g, 'е');
  if (city && AVITO_CITIES[city]) return AVITO_CITIES[city];
  return /ростовская/i.test(address ?? '') ? 'rostovskaya_oblast' : 'rossiya';
}

export function avitoUrl(query, address) {
  return `https://www.avito.ru/${avitoRegion(address)}/predlozheniya_uslug?q=${encodeURIComponent(query)}`;
}

export function yandexUrl(query) {
  return `https://uslugi.yandex.ru/search?text=${encodeURIComponent(query)}`;
}

/* ─────────────── разметка ─────────────── */

function listMarkup() {
  return html`
    <div class="dt-p" style="margin-top:0;color:var(--tx-2);font-size:14px">
      Выберите, что случилось, — откроем поиск мастера на Авито
      или в Яндекс Услугах с готовым запросом.
    </div>

    ${GROUPS.map((g) => html`
      <div class="field-label">${esc(g.title)}</div>
      <div class="list">
        ${g.items.map((item) => html`
          <button class="row tappable master-item" data-action="master-pick" data-id="${esc(item.id)}">
            <div class="content"><div class="t">${esc(item.label)}</div></div>
            <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </button>`).join('')}
      </div>`).join('')}

    <div class="field-label">Другое</div>
    <textarea id="masterOther" placeholder="Например: заменить дверной доводчик"></textarea>
    <button class="btn-primary" data-action="master-other">Найти мастера</button>`;
}

function whereMarkup(item) {
  return html`
    <div class="dt-title" style="margin-top:0">${esc(item.label)}</div>
    <div class="dt-p" style="color:var(--tx-2);font-size:14px">
      Где проблема? От этого зависит, кто чинит и нужно ли платить.
    </div>
    <div class="list" style="margin-top:12px">
      <button class="row tappable" data-action="master-where" data-v="flat">
        <div class="content">
          <div class="t">В квартире</div>
          <div class="d">После крана или автомата в квартире — это ваш ремонт</div>
        </div>
      </button>
      <button class="row tappable" data-action="master-where" data-v="common">
        <div class="content">
          <div class="t">В подъезде, стояк или щиток на площадке</div>
          <div class="d">Общее имущество дома — его чинит управляющая компания</div>
        </div>
      </button>
    </div>
    <button class="btn-primary secondary" data-action="master-back">Назад к списку</button>`;
}

function commonMarkup(item) {
  return html`
    <div class="dt-title" style="margin-top:0">Это чинит управляющая компания</div>
    <div class="dt-p" style="color:var(--tx-2);font-size:14px">
      Стояки, щитки на площадке и всё, что до первого крана и автомата
      в квартире, — общее имущество дома. Ремонт входит в плату за
      содержание, платить мастеру не нужно. Подайте жалобу — она сохранится
      с датой, и её нельзя удалить.
    </div>
    <button class="btn-primary" data-action="master-complaint">Подать жалобу</button>
    <button class="btn-primary secondary" data-action="master-where" data-v="flat">Всё же найти мастера</button>`;
}

function searchMarkup(state) {
  const address = state.currentProperty?.addressRaw ?? '';
  const city = cityOf(address);
  return html`
    ${step.item ? html`<div class="dt-title" style="margin-top:0">${esc(step.item.label)}</div>` : ''}
    <div class="field-label">Что ищем</div>
    <input type="text" id="masterQuery" value="${esc(step.query)}">
    <div class="dt-p" style="color:var(--tx-2);font-size:13px;margin-top:8px">
      Запрос можно поправить.${city ? ` Поиск — ${esc(city)} и рядом.` : ''}
    </div>

    <button class="btn-primary master-avito" data-action="master-open" data-to="avito">Найти на Авито</button>
    <button class="btn-primary master-yandex" data-action="master-open" data-to="yandex">Найти в Яндекс Услугах</button>

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Мастеров подбирают Авито и Яндекс. Мы исполнителей не проверяем —
      смотрите отзывы и договаривайтесь о цене до начала работ.
    </div>
    <button class="btn-primary secondary" data-action="master-back">Назад к списку</button>`;
}

function stepMarkup(state) {
  if (step.name === 'where') return whereMarkup(step.item);
  if (step.name === 'common') return commonMarkup(step.item);
  if (step.name === 'search') return searchMarkup(state);
  return listMarkup();
}

export function renderMaster(state) {
  // Каждый вход на экран — с начала списка
  step = { name: 'list' };
  return html`<div id="masterRoot">${stepMarkup(state)}</div>`;
}

function redraw(ctx) {
  const root = document.querySelector('#masterRoot');
  if (!root) return;
  root.innerHTML = stepMarkup(ctx.state);
  root.closest('.page')?.scrollTo?.({ top: 0 });
}

/* ─────────────── действия ─────────────── */

/** true — действие обработано экраном мастера */
export async function handleMasterAction(action, target, ctx) {
  switch (action) {
    case 'master-pick': {
      const item = ITEMS.get(target.dataset.id);
      if (!item) return true;
      step = item.common ? { name: 'where', item } : { name: 'search', item, query: item.query };
      redraw(ctx);
      return true;
    }

    case 'master-other': {
      const text = document.querySelector('#masterOther')?.value.trim();
      if (!text) {
        document.querySelector('#masterOther')?.focus();
        return true;
      }
      step = { name: 'search', item: null, query: text };
      redraw(ctx);
      return true;
    }

    case 'master-where':
      step = target.dataset.v === 'common'
        ? { name: 'common', item: step.item }
        : { name: 'search', item: step.item, query: step.item.query };
      redraw(ctx);
      return true;

    case 'master-back':
      step = { name: 'list' };
      redraw(ctx);
      return true;

    case 'master-complaint':
      await ctx.go('complaint', {
        category: step.item?.category ?? 'Общее имущество',
        text: `${step.item?.label ?? 'Проблема'} — в подъезде, на стояке или в щитке на площадке.`,
      });
      return true;

    case 'master-open': {
      const query = document.querySelector('#masterQuery')?.value.trim() || step.query;
      const address = ctx.state.currentProperty?.addressRaw ?? '';
      platform.haptic('light');
      platform.openLink(target.dataset.to === 'yandex' ? yandexUrl(query) : avitoUrl(query, address));
      return true;
    }

    default:
      return false;
  }
}
