import { api } from '../api.js';
import { esc, html, money, formatDate, plural, loadingState, errorState, emptyState } from '../ui.js';

/**
 * Главная жителя.
 *
 * Порядок блоков подчинён тому, зачем человек открывает приложение:
 * авария сверху, потом деньги, потом свои заявки, потом услуги.
 */

/**
 * Плитки услуг.
 *
 * Иконки — из набора дизайнера, лежат в public/icons/services. Подключены
 * CSS-маской, а не картинкой: маска берёт из файла только форму, а цвет
 * задаёт плитка. Так иконка остаётся белой на любом градиенте и не
 * потребует переэкспорта, если палитра поменяется.
 */
/**
 * Плитки — только действия по СВОЕЙ квартире.
 *
 * «Оплата ЖКУ» открывается карточкой начислений прямо над ними,
 * «Объявления дома» и «Соседи предлагают» живут во вкладке «Дом»,
 * «Шеринг доступа» — в профиле. Дублировать их плиткой значит делать
 * из главной оглавление приложения вместо панели действий.
 */
const SERVICES = [
  { cls: 'c1', route: 'complaint', label: 'Подать жалобу', icon: 'complaint' },
  { cls: 'c2', route: 'master', label: 'Вызов мастера', icon: 'master' },
  { cls: 'c3', route: 'meters', label: 'Показания счётчиков', icon: 'meters' },
  { cls: 'c4', route: 'analytics', label: 'Аналитика потребления', icon: 'analytics' },
  { cls: 'c3', route: 'polls', label: 'Опросы дома', icon: 'polls' },
  { cls: 'c6', route: 'emergency', label: 'Аварийные службы', icon: 'emergency' },
];


export function homeSkeleton() {
  return `<div class="page active" id="page-home">${loadingState('Собираем данные по вашему адресу…')}</div>`;
}

/**
 * Вход в раздел «Совет дома».
 *
 * Появляется, только когда есть что разобрать: карточка с числом заявок,
 * а не постоянный пункт меню. Это и есть замена второму профилю —
 * не режим, а обычный переход, из которого возвращаются кнопкой «Назад».
 */
function councilCard(state) {
  const council = state.chairman;
  if (!council?.isChairman) return '';

  const waiting = council.houses.reduce((n, h) => n + h.pendingClaims, 0);
  if (waiting === 0) return '';

  return html`
    <button class="alert" data-action="council">
      <span class="ic">
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M4 9L11 3.5L18 9V18H4V9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 18V12H14V18" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </span>
      <div>
        <div class="t">Совет дома</div>
        <div class="d">
          ${waiting} ${plural(waiting, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} вашего решения
        </div>
      </div>
      <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>`;
}


/**
 * Приём кода приглашения.
 *
 * Стоит там, где человек оказывается без квартиры: он пришёл по ссылке
 * или с кодом от собственника, и сканировать ему нечего — квитанция
 * на квартиру одна и лежит не у него.
 */
export function inviteCodeCard() {
  return html`
    <div class="dt-card">
      <div class="meter-name">Вас пригласил собственник?</div>
      <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
        Введите код из приглашения — квитанция для этого не нужна.
      </div>
      <input type="text" id="inviteCode" placeholder="Например, K7MD9P"
             autocomplete="off" autocapitalize="characters"
             style="letter-spacing:.16em;text-transform:uppercase">
      <div class="field-error" id="inviteErr"></div>
      <button class="btn-primary secondary" data-action="redeem-invite">Войти по коду</button>
    </div>`;
}

export async function renderHome(state) {
  const { me } = state;
  const property = state.currentProperty;

  /**
   * Доступ к дому ещё не подтверждён.
   *
   * ГЛАВНОЕ ЗДЕСЬ — что жалоба всё равно работает. Ради неё продукт
   * и ставят: у жителя должно остаться доказательство, что он пожаловался,
   * и оно должно лечь в архив УК, откуда его нельзя удалить. Ждать
   * председателя ради этого незачем — тем более что у дома его может
   * не быть вовсе.
   *
   * Раньше человек здесь попадал на «Адрес не привязан» с кнопкой,
   * которая ВЫХОДИТ ИЗ АККАУНТА, — а на экране заявки ему обещали
   * обратное: «сканировать заново не нужно, мы вас запомнили».
   */
  if (!property && me.myPendingAccess?.length) {
    const waiting = me.myPendingAccess[0];
    /**
     * Подтверждает ВСЕГДА председатель совета дома.
     *
     * Если его нет, честно говорим об этом и что делать: УК назначает
     * председателя, а не подтверждает жителей сама. Раньше здесь было
     * написано «подтверждает управляющая компания» — обещание, которое
     * приложение больше не выполняет.
     */
    const hasChairman = waiting.deciders?.chairman;
    const houseHasUk = waiting.deciders?.dispatcher;

    return html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">
          ${waiting.status === 'revoked' ? 'Заявка отклонена' : 'Заявка на рассмотрении'}
        </div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${waiting.status === 'revoked'
            ? esc(waiting.rejectReason ?? 'Причина не указана')
            : !waiting.claimComplete
              ? 'Расскажите о себе — без этого подтвердить заявку нельзя.'
              : hasChairman
                ? `Доступ к соседям и ленте дома подтверждает председатель
                   совета дома. Сканировать квитанцию заново не нужно —
                   мы вас запомнили.`
                : houseHasUk
                  ? `У дома пока нет председателя, и подтвердить доступ
                     к соседям некому. Попросите управляющую компанию его
                     назначить — это делается один раз.`
                  : `Дома пока нет в реестре управляющих организаций,
                     поэтому подтвердить доступ к соседям некому.`}
        </div>
        ${waiting.addressRaw
          ? html`<div class="dt-p" style="font-size:13px">${esc(waiting.addressRaw)}</div>`
          : ''}
        <button class="btn-primary secondary" data-action="check-access">Проверить</button>
      </div>

      <div class="dt-card">
        <div class="meter-name">Пожаловаться можно уже сейчас</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          Обращение уйдёт в управляющую компанию и останется в её архиве.
          Удалить его она не может — только изменить статус.
        </div>
        <button class="btn-primary" data-action="complaint">Написать обращение</button>
      </div>

      ${inviteCodeCard()}`;
  }

  if (!property) {
    return html`
      ${emptyState(
        'Адрес не привязан',
        'Отсканируйте квитанцию, чтобы приложение узнало ваш лицевой счёт',
        { label: 'Отсканировать', action: 'logout' },
      )}
      ${inviteCodeCard()}`;
  }

  let requests = { active: [], archive: [] };
  let feed = [];
  try {
    [requests, feed] = await Promise.all([
      api.requests(property.propertyId),
      api.feed().then((r) => r.posts).catch(() => []),
    ]);
  } catch (error) {
    return errorState(error, 'reload');
  }

  /**
   * На баннер попадает только действующее отключение.
   *
   * Раньше бралось последнее по дате, без оглядки на срок, и «нет воды
   * до 18:00» висело на главном экране неделями — до следующей аварии.
   */
  const outage = feed.find((p) => p.category === 'outage' && !p.expired);
  const bill = property.bill;

  return html`
    <div class="idrow">
      <div>
        <button class="locpill tappable" data-action="properties">
          ${esc(propertyTitle(property))}
          ${property.status === 'pending'
            ? '<span class="pill new" style="margin-left:2px">ожидает</span>'
            : ''}
          <svg viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        ${property.ukName ? html`
          <div class="greetline"><span class="dot"></span>${esc(property.ukName)}</div>`
          : ''}
      </div>
      <button class="bell" data-action="notifications" aria-label="Уведомления">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 10C6 6.7 8.4 4 12 4C15.6 4 18 6.7 18 10C18 13.5 20 15 20 16H4C4 15 6 13.5 6 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 19C10 20 10.9 20.8 12 20.8C13.1 20.8 14 20 14 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>

    ${me.pendingRequests?.length ? renderAccessRequests(me.pendingRequests) : ''}

    ${property.status === 'pending' ? html`
      <div class="dt-card">
        <div class="meter-name">Доступ к дому ещё не подтверждён</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${waitingText(property)}
        </div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2)">
          Начисления, счётчики, аналитика и обращение в управляющую компанию
          по этой квартире работают уже сейчас.
        </div>
      </div>` : ''}

    ${councilCard(state)}

    ${outage ? html`
      <button class="alert" data-action="post" data-id="${esc(outage.id)}">
        <span class="ic"><svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M11 2L20 19H2L11 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 9V13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11" cy="15.6" r="1" fill="currentColor"/></svg></span>
        <div><div class="t">${esc(outage.title)}</div><div class="d">${esc(outage.body.slice(0, 70))}</div></div>
        <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </button>` : ''}

    <button class="pay-card tappable" data-action="payment">
      <div class="pay-card-top">
        <!--
          Подпись приходит с сервера и всегда с годом. Своя сборка год
          выбрасывала: в августе начисление за апрель подписывалось
          «Начислено за апрель» и читалось как долг за текущий месяц.
          Если начисление старше прошлого месяца, говорим об этом прямо —
          свежее у нас просто нет.
        -->
        <span>${bill?.periodLabel
          ? esc(bill.periodStale
              ? `Последнее начисление · ${bill.periodLabel}`
              : `Начислено за ${bill.periodLabel}`)
          : 'Начисления'}</span>
        <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </div>
      <div class="pay-amt">${bill?.sumKopecks != null ? money(bill.sumKopecks) : '—'}</div>
      <div class="pay-card-bottom">
        <span class="pay-due">
          ${bill?.billCount > 1
            // Сумма собрана из нескольких квитанций: ЖКУ, свет, вывоз мусора.
            // Без пояснения она выглядит завышенной и вызывает недоверие
            ? `${esc(bill.billCount)} ${plural(bill.billCount, 'квитанция', 'квитанции', 'квитанций')} за квартиру`
            // Дома нет в реестре управляющих организаций: молчать нельзя,
            // иначе непонятно, почему не работают заявки
            : esc(property.ukName ?? 'управляющая компания не определена')}
        </span>
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
          <span class="ic">
            <i class="svc-icon" style="--svc-icon:url('icons/services/${s.icon}.svg')"></i>
          </span>
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
          <button class="pay-quickbtn tappable" style="background:var(--fade);color:var(--negative)"
                  data-action="reject" data-id="${esc(p.bindingId)}">Отклонить</button>
        </div>`).join('')}
    </div>`;
}

function requestRow(r) {
  const tone = r.status === 'done' ? 'ok' : r.status === 'new' ? 'new' : '';

  /**
   * Заявка, где ход за жителем, помечена и здесь.
   *
   * Главный экран — единственный, куда человек заходит регулярно. Если
   * вопрос диспетчера виден только внутри карточки заявки, житель узнает
   * о нём в лучшем случае через неделю, а срок реакции всё это время идёт.
   */
  const icon = r.awaitingResident
    ? '<path d="M10 3.2C6.3 3.2 3.3 5.7 3.3 8.8C3.3 10.6 4.3 12.2 5.9 13.2L5.2 16L8.2 14.3C8.8 14.4 9.4 14.5 10 14.5C13.7 14.5 16.7 12 16.7 8.8C16.7 5.7 13.7 3.2 10 3.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'
    : r.status === 'done'
      ? '<path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/><path d="M10 6V10.2L12.8 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';

  return html`
    <button class="wrow tappable" data-action="request" data-id="${esc(r.id)}">
      <span class="sq ${r.awaitingResident ? '' : tone}"><svg viewBox="0 0 20 20" fill="none">${icon}</svg></span>
      <div class="content">
        <div class="t">${esc(r.title)}</div>
        <div class="d ${r.awaitingResident ? 'ask' : ''}">
          ${r.awaitingResident ? 'Диспетчер ждёт вашего ответа' : `№ ${esc(r.number)} · ${esc(r.category)}`}
        </div>
      </div>
      <span class="pill ${tone}">${esc(r.statusLabel)}</span>
    </button>`;
}

export function greetingFor(date) {
  const h = date.getHours();
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
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

/**
 * Подпись объекта в списках.
 *
 * У ожидающего объекта адреса может не быть вовсе: сервер отдаёт его,
 * только если человек принёс адрес сам. Это не ошибка загрузки, и писать
 * «Адрес неизвестен» нельзя — человек решит, что приложение сломалось.
 */
export function propertyTitle(p) {
  if (p.addressRaw || p.street) return shortAddress(p);
  return 'Новый адрес';
}

/**
 * Чего ждёт ожидающий объект.
 *
 * Подтверждает ВСЕГДА председатель совета дома. Если его нет, честно
 * говорим об этом и что делать: УК назначает председателя, а не
 * подтверждает жителей сама.
 *
 * Живёт здесь, а не в экране объекта: текст нужен четырём экранам,
 * а `home.js` не импортирует ни один из них — так не возникает кольца
 * импортов.
 */
export function waitingText(p) {
  if (p.deciders?.chairman) {
    return `Доступ к дому и соседям подтверждает председатель совета дома.
            Сканировать квитанцию заново не нужно — мы вас запомнили.`;
  }
  if (p.deciders?.dispatcher) {
    return `У дома пока нет председателя, и подтвердить доступ к соседям
            некому. Попросите управляющую компанию его назначить —
            это делается один раз.`;
  }
  return `Дома пока нет в реестре управляющих организаций, поэтому
          подтвердить доступ к соседям некому.`;
}
