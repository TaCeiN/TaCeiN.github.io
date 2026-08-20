import { api } from '../api.js';
import { esc, html, money, formatDate, loadingState, errorState, emptyState } from '../ui.js';

/**
 * Главная жителя.
 *
 * Порядок блоков подчинён тому, зачем человек открывает приложение:
 * авария сверху, потом деньги, потом свои заявки, потом услуги.
 */

const SERVICES = [
  { cls: 'c1', route: 'complaint', label: 'Подать жалобу', icon: 'complaint' },
  { cls: 'c2', route: 'master', label: 'Вызов мастера', icon: 'master' },
  { cls: 'c3', route: 'meters', label: 'Показания счётчиков', icon: 'meters' },
  { cls: 'c5', route: 'payment', label: 'Оплата ЖКУ', icon: 'pay' },
  { cls: 'c4', route: 'analytics', label: 'Аналитика потребления', icon: 'chart' },
  { cls: 'c3', route: 'polls', label: 'Опросы дома', icon: 'vote' },
  { cls: 'c1', route: 'market', label: 'Соседи предлагают', icon: 'market' },
  { cls: 'c4', route: 'feed', label: 'Объявления дома', icon: 'board' },
  { cls: 'c2', route: 'access', label: 'Шеринг доступа', icon: 'key' },
  { cls: 'c6', route: 'emergency', label: 'Аварийные службы', icon: 'sos' },
];

const ICONS = {
  complaint: '<path d="M5 3H17V19H5V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 7V12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="11" cy="15.2" r="1" fill="currentColor"/>',
  master: '<path d="M14.5 3.2C12.8 3.2 11.4 4.6 11.4 6.3C11.4 6.8 11.5 7.2 11.7 7.6L4.2 15.1C3.6 15.7 3.6 16.7 4.2 17.3C4.8 17.9 5.8 17.9 6.4 17.3L13.9 9.8C14.3 10 14.7 10.1 15.2 10.1C16.9 10.1 18.3 8.7 18.3 7C18.3 6.5 18.2 6.1 18 5.7L16.1 7.6L14 7L13.4 4.9L15.3 3C14.9 3.1 14.7 3.2 14.5 3.2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  meters: '<rect x="3" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 6V4H15V6M7 12H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  pay: '<circle cx="11" cy="11" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 8H12.5C13.6 8 14.5 8.7 14.5 9.7C14.5 10.7 13.6 11.4 12.5 11.4H8.5M8.5 11.4H13.5M8.5 14.5H12.5C13.6 14.5 14.5 13.9 14.5 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  chart: '<path d="M4 18V11M9 18V5M14 18V13M19 18V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  vote: '<path d="M4 11L9 16L18 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  market: '<path d="M4 7.5H18L17 18H5L4 7.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 7.5V5.5C8 4.3 9.3 3.3 11 3.3C12.7 3.3 14 4.3 14 5.5V7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  board: '<rect x="3" y="4" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 8.5H15.5M6.5 12H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  key: '<circle cx="7.5" cy="14.5" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 12L18 4M15.5 6.5L17.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  sos: '<path d="M4 8C4 5 7 3 11 3C15 3 18 5 18 8V12C18 13 17.2 13.5 16.5 13.5H15.5C14.8 13.5 14 13 14 12V10C14 9 14.8 8.5 15.5 8.5H18M4 8V12C4 13 4.8 13.5 5.5 13.5H6.5C7.2 13.5 8 13 8 12V10C8 9 7.2 8.5 6.5 8.5H4" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 17C8 18.5 9.5 19 11 19" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
};

const svg = (name) => `<svg viewBox="0 0 22 22" fill="none">${ICONS[name]}</svg>`;

export function homeSkeleton() {
  return `<div class="page active" id="page-home">${loadingState('Собираем данные по вашему адресу…')}</div>`;
}

export async function renderHome(state) {
  const { me } = state;
  const property = state.currentProperty;

  if (!property) {
    return emptyState(
      'Адрес не привязан',
      'Отсканируйте квитанцию, чтобы приложение узнало ваш лицевой счёт',
      { label: 'Отсканировать', action: 'logout' },
    );
  }

  let requests = { active: [], archive: [] };
  let feed = [];
  try {
    [requests, feed] = await Promise.all([
      api.requests(),
      api.feed().then((r) => r.posts).catch(() => []),
    ]);
  } catch (error) {
    return errorState(error, 'reload');
  }

  const outage = feed.find((p) => p.category === 'outage');
  const bill = property.bill;
  const greeting = greetingFor(new Date());
  const firstName = (me.user.name ?? '').split(' ')[1] ?? me.user.name;

  return html`
    <div class="idrow">
      <div>
        <button class="locpill tappable" data-action="properties">
          ${esc(shortAddress(property))}
          <svg viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="greetline">${esc(greeting)}, ${esc(firstName)}</div>
      </div>
      <button class="bell" data-action="notifications" aria-label="Уведомления">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 10C6 6.7 8.4 4 12 4C15.6 4 18 6.7 18 10C18 13.5 20 15 20 16H4C4 15 6 13.5 6 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 19C10 20 10.9 20.8 12 20.8C13.1 20.8 14 20 14 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>

    ${me.pendingRequests?.length ? renderAccessRequests(me.pendingRequests) : ''}

    ${outage ? html`
      <button class="alert" data-action="post" data-id="${esc(outage.id)}">
        <span class="ic"><svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M11 2L20 19H2L11 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 9V13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11" cy="15.6" r="1" fill="currentColor"/></svg></span>
        <div><div class="t">${esc(outage.title)}</div><div class="d">${esc(outage.body.slice(0, 70))}</div></div>
        <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </button>` : ''}

    <button class="pay-card tappable" data-action="payment">
      <div class="pay-card-top">
        <span>${bill?.period ? `Начисление за ${periodName(bill.period)}` : 'Начисления'}</span>
        <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </div>
      <div class="pay-amt">${bill?.sumKopecks != null ? money(bill.sumKopecks) : '—'}</div>
      <div class="pay-card-bottom">
        <span class="pay-due">${esc(property.ukName ?? '')}</span>
        <span class="pay-quickbtn tappable" data-action="pay">Оплатить</span>
      </div>
    </button>

    <div class="s-label"><h2>Мои обращения</h2><a data-action="requests">все</a></div>
    <div class="widget">
      ${requests.active.length
        ? requests.active.slice(0, 3).map(requestRow).join('')
        : `<div style="padding:24px 16px;text-align:center">
             <div style="font-size:15px;font-weight:500;color:var(--tx)">Активных обращений нет</div>
             <div style="font-size:13px;color:var(--tx-2);margin-top:4px">Новые заявки появятся здесь</div>
           </div>`}
    </div>

    <div class="s-label"><h2>Услуги</h2></div>
    <div class="services">
      ${SERVICES.map((s) => html`
        <button class="svc ${s.cls}" data-action="${s.route}">
          <span class="ic">${svg(s.icon)}</span>
          <span class="label">${esc(s.label)}</span>
        </button>`).join('')}
    </div>
  `;
}

function renderAccessRequests(pending) {
  return html`
    <div class="field-label" style="margin-top:18px">Запросы доступа к вашему адресу</div>
    <div class="list">
      ${pending.map((p) => html`
        <div class="row">
          <span class="sq new"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7.5" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 17C4.5 13.8 7 12.4 10 12.4C13 12.4 15.5 13.8 15.5 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
          <div class="content">
            <div class="t">${esc(p.requesterName)}</div>
            <div class="d">Просит доступ к ${esc(p.addressRaw?.split(',').slice(-1)[0]?.trim() ?? 'вашему адресу')}</div>
          </div>
          <button class="pay-quickbtn tappable" style="background:var(--accent);color:#fff"
                  data-action="approve" data-id="${esc(p.bindingId)}">Разрешить</button>
        </div>`).join('')}
    </div>`;
}

function requestRow(r) {
  const tone = r.status === 'done' ? 'ok' : r.status === 'new' ? 'new' : '';
  const icon = r.status === 'done'
    ? '<path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/><path d="M10 6V10.2L12.8 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';

  return html`
    <button class="wrow tappable" data-action="request" data-id="${esc(r.id)}">
      <span class="sq ${tone}"><svg viewBox="0 0 20 20" fill="none">${icon}</svg></span>
      <div class="content">
        <div class="t">${esc(r.title)}</div>
        <div class="d">№ ${esc(r.number)} · ${esc(r.category)}</div>
      </div>
      <span class="pill ${tone}">${esc(r.statusLabel)}</span>
    </button>`;
}

function greetingFor(date) {
  const h = date.getHours();
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function periodName(period) {
  const [, month] = period.split('-');
  return MONTHS[Number(month) - 1] ?? period;
}

/** Короткая подпись адреса: улица, дом и квартира без города и индекса. */
export function shortAddress(p) {
  const street = p.street ? capitalise(p.street) : (p.addressRaw ?? '').split(',')[2]?.trim() ?? '';
  const house = [p.house, p.block ? `к${p.block}` : null].filter(Boolean).join('');
  const flat = p.flat ? `кв. ${p.flat}` : '';
  return [[street, house].filter(Boolean).join(' '), flat].filter(Boolean).join(', ');
}

function capitalise(value) {
  return value.replace(/(^|[\s-])([а-яёa-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
