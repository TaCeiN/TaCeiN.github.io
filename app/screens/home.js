import { api } from '../api.js';
import { esc, html, money, formatDate, plural, loadingState, errorState, emptyState } from '../ui.js';
import { wipBadge } from '../wip.js';

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

/**
 * Плитки по объекту, а не по всему списку.
 *
 * У частного дома «дома» как сообщества нет: соседей и опросов там
 * не бывает по определению. Плитка вела бы на пустой раздел, который
 * читается как поломка, поэтому убираем её, а не показываем пустой.
 */
function servicesFor(property) {
  if (property?.houseManagement?.form === 'private') {
    return SERVICES.filter((s) => s.route !== 'polls');
  }
  return SERVICES;
}


export function homeSkeleton() {
  return `<div class="page active" id="page-home">${loadingState('Собираем данные по вашему адресу…')}</div>`;
}

/**
 * Вход в раздел «Совет дома».
 *
 * Появляется, только когда есть что разобрать: карточка с числом дел,
 * а не постоянный пункт меню. Это и есть замена второму профилю —
 * не режим, а обычный переход, из которого возвращаются кнопкой «Назад».
 *
 * ДВА ИСТОЧНИКА ДЕЛ, ОДНА КАРТОЧКА. Раньше карточка считала только заявки
 * на доступ (`pendingClaims`), и у дома без УК, где все жильцы уже
 * подтверждены, вход в раздел с главной пропадал совсем — а жалоба,
 * которую председатель обязан прочитать, лежала непрочитанной: раздел
 * оставался достижим только из профиля, куда пожилой человек не пойдёт
 * искать то, о чём не знает.
 */
function councilCard(state) {
  const council = state.chairman;
  if (!council?.isChairman) return '';

  const claims = council.houses.reduce((n, h) => n + h.pendingClaims, 0);
  const requests = council.houses.reduce((n, h) => n + (h.awaitingRequests ?? 0), 0);
  const total = claims + requests;

  /**
   * ПУСТАЯ ОЧЕРЕДЬ — ЭТО НЕ ПОВОД ПРЯТАТЬ РАЗДЕЛ.
   *
   * Здесь стояло `if (total === 0) return ''`, и хуже всего это работало
   * ровно в тот момент, ради которого раздел существует: у только что
   * подключённого дома заявок нет (их закрывает само назначение),
   * обращений ещё нет — и человек, которого минуту назад сделали
   * председателем, не видел на главной ни одного следа своей роли.
   * Проверено на живом стенде 11 сентября.
   *
   * Комментарий к прошлой правке этого же места уже говорил, чем
   * заканчивается пропавшая карточка: «раздел оставался достижим только
   * из профиля, куда пожилой человек не пойдёт искать то, о чём
   * не знает». Тогда добавили второй счётчик; случай, где нулевые оба,
   * правка не покрыла.
   *
   * Поэтому карточка теперь есть всегда, а меняется только её вторая
   * строка: дела — числом, их отсутствие — приглашением.
   */
  const line = total > 0
    ? `${total} ${plural(total, 'дело ждёт', 'дела ждут', 'дел ждут')} вашего внимания`
    : 'Подтверждение соседей, объявления, опросы и обращения дома';

  return html`
    <button class="alert" data-action="council">
      <span class="ic">
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M4 9L11 3.5L18 9V18H4V9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 18V12H14V18" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </span>
      <div>
        <div class="t">Совет дома</div>
        <div class="d">${esc(line)}</div>
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

/**
 * Подпись над суммой на карточке оплаты.
 *
 * «К оплате» — слово владельца. Честности в нём самом нет: оно читается
 * как требование управляющей компании, а приложение статуса оплаты
 * НЕ ЗНАЕТ — ни из QR, ни из биллинга УК, ни из ГИС ЖКХ. Поэтому под
 * суммой обязательна оговорка из payNote(), и убирать её нельзя.
 */
function payTitle(bill) {
  // Поля нет вовсе — старый сервер под новым фронтом
  if (bill?.outstandingKopecks == null) return 'Начисления';
  if (!bill.hasBills) return 'Начисления';
  return bill.unpaidCount === 0 ? 'Всё отмечено оплаченным' : 'К оплате';
}

/**
 * Строка под суммой: источник знания и объём.
 *
 * Число начислений здесь не для красоты — сумма собрана из нескольких
 * квитанций разных организаций и за разные месяцы, и без пояснения
 * выглядит завышенной. При просрочке важнее сказать про срок: так же
 * ведёт себя экран «Оплата ЖКУ», а два экрана про одни деньги обязаны
 * вести себя одинаково.
 */
function payNote(bill) {
  // Молчим, а не врём: «квитанций нет» здесь означало бы, что их нет
  // у человека, — а на деле их нет только у нас
  if (bill?.outstandingKopecks == null) return '';
  if (!bill.hasBills) return 'Квитанций пока нет';
  if (bill.overdueCount > 0) return `по вашим отметкам · срок прошёл у ${bill.overdueCount}`;
  if (bill.unpaidCount > 0) {
    const word = plural(bill.unpaidCount, 'начисление', 'начисления', 'начислений');
    return `по вашим отметкам · ${bill.unpaidCount} ${word}`;
  }
  return 'по вашим отметкам';
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
    // Не просто «организация известна» — у неё должен быть свой кабинет,
    // куда мог бы зайти диспетчер и назначить председателя.
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
                  : `У дома пока нет ни председателя, ни доступного кабинета
                     управляющей организации — подтвердить доступ к соседям
                     некому.`}
        </div>
        ${waiting.addressRaw
          ? html`<div class="dt-p" style="font-size:13px">${esc(waiting.addressRaw)}</div>`
          : ''}
        ${askOperatorBlock(waiting)}
        <button class="btn-primary secondary" data-action="check-access">Проверить</button>
      </div>

      ${/**
         * Отклонённой заявке жаловаться НЕ ПО ЧЕМУ.
         *
         * Объект такого человека не приходит в `properties` — сервер
         * отдаёт туда только подтверждённые и ожидающие, — поэтому
         * выбранного объекта у приложения нет, и обращению некуда
         * привязаться. Пока карточка показывалась и здесь, кнопка вела
         * на открытую форму, а отправка падала технической ошибкой:
         * человек читал непонятное сообщение вместо «принято».
         *
         * Что делать дальше, ему говорит причина отказа выше и поле
         * кода приглашения ниже.
         */
        waiting.status === 'revoked' ? '' : html`
        <div class="dt-card">
          <div class="meter-name">Пожаловаться можно уже сейчас</div>
          <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
            ${waiting.houseManagement?.orgName
              ? html`Обращение уйдёт в управляющую компанию и останется
                      в её архиве. Удалить его она не может — только
                      изменить статус.`
              : html`Обращение сохранится с датой и останется у вас — это
                      работает, даже если адресата у дома пока нет.`}
          </div>
          <button class="btn-primary" data-action="complaint">Написать обращение</button>
        </div>`}

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
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="locpill tappable" data-action="properties">
            ${esc(propertyTitle(property))}
            <svg viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <!--
            Пометка «ожидает» — отдельная кнопка, а не часть кнопки адреса.

            Раньше она стояла внутри кнопки, ведущей к списку квартир, а под
            шапкой висели две карточки: объяснение с «Проверить» и поле кода
            приглашения. При каждом входе, над оплатой, хотя нужны они
            в основном один раз. Теперь всё это открывается шторкой по нажатию
            на пометку, а главная ожидающего жителя выглядит так же, как
            у подтверждённого. Стрелка нужна, чтобы было видно: нажимается.
          -->
          ${property.status === 'pending' ? html`
            <button type="button" class="pill new tappable" data-action="pending-sheet"
                    aria-haspopup="dialog"
                    style="display:inline-flex;align-items:center;gap:3px;padding:7px 10px">
              ожидает
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>` : ''}
        </div>
        ${property.ukName ? html`
          <div class="greetline"><span class="dot"></span>${esc(property.ukName)}</div>`
          : ''}
      </div>
      <button class="bell" data-action="notifications" aria-label="Уведомления">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 10C6 6.7 8.4 4 12 4C15.6 4 18 6.7 18 10C18 13.5 20 15 20 16H4C4 15 6 13.5 6 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 19C10 20 10.9 20.8 12 20.8C13.1 20.8 14 20 14 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>

    <!--
      Порядок: действующая авария, потом деньги, потом всё остальное.

      Оплата — главная причина открыть приложение, и она стоит первой.
      Единственное, что выше неё, — отключение: «нет воды до 18:00» важнее
      суммы, а висит баннер только пока отключение действует.
    -->
    ${outage ? html`
      <button class="alert" data-action="post" data-id="${esc(outage.id)}">
        <span class="ic"><svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M11 2L20 19H2L11 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 9V13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11" cy="15.6" r="1" fill="currentColor"/></svg></span>
        <div><div class="t">${esc(outage.title)}</div><div class="d">${esc(outage.body.slice(0, 70))}</div></div>
        <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </button>` : ''}

    <button class="pay-card tappable" data-action="payment">
      <div class="pay-card-top">
        <span>${esc(payTitle(bill))}</span>
        <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </div>
      <!--
        Прочерк, а не «0,00 ₽», пока квитанций не приносили: ноль читается
        как «мы посчитали, и долгов нет», хотя считать было нечего.
      -->
      <div class="pay-amt" style="${bill?.overdueCount ? 'color:var(--negative)' : ''}">
        ${bill?.hasBills ? money(bill.outstandingKopecks) : '—'}
      </div>
      <div class="pay-card-bottom">
        <span class="pay-due">${esc(payNote(bill))}</span>
        ${bill?.outstandingKopecks ? `<span class="pay-quickbtn tappable" data-action="pay">Оплатить</span>` : ""}
      </div>
    </button>

    ${me.pendingRequests?.length ? renderAccessRequests(me.pendingRequests) : ''}

    ${councilCard(state)}

    <!--
      Квитанция приходит каждый месяц, и это самое частое действие после
      оплаты. Пока кнопка жила в профиле, человек искал её заново каждый
      раз: «куда нажать, чтобы добавить новую платёжку».
    -->
    <button class="alert receipt-cta" data-action="add-receipt-home">
      <span class="ic">
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M5 3h12v16l-2.5-1.5L12 19l-2.5-1.5L7 19l-2-1.2V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 7.5h6M8 11h6M8 14.5h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </span>
      <div>
        <div class="t">Добавить квитанцию</div>
        <!--
          Подпись короче прежней («…, адрес не спросим») намеренно:
          рядом стоят иллюстрация и стрелка, и на полную фразу остаётся
          колонка, в которой она рвётся на неровные строки. «За эту же
          квартиру» и означает, что адрес спрашивать не будут.
        -->
        <div class="d">Свет, газ, вода — за эту же квартиру</div>
      </div>
      <!--
        Иллюстрация из макета, а не своя рисовка: подогнана под экран
        (240px вместо 1280px — 43 КБ против 841 КБ) и лежит в public/icons/art.
        Украшение, поэтому скрыта от чтения с экрана и уступает место словам
        на узком экране.
      -->
      <img class="receipt-art" src="icons/art/receipt-stack.png" alt="" aria-hidden="true">
      <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
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
      ${servicesFor(property).map((s) => html`
        <button class="svc ${s.cls}" data-action="${s.route}">
          <span class="ic">
            <i class="svc-icon" style="--svc-icon:url('icons/services/${s.icon}.svg')"></i>
          </span>
          ${wipBadge(s.route)}
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
/**
 * Та же правда одной строкой — для списков, где кнопке места нет.
 *
 * ЗАЧЕМ ОТДЕЛЬНО. В профиле стоял свой тернарник на три ветки, и случая
 * частного дома в нём не было: второй житель своего дома читал там
 * «У дома нет ни председателя, ни доступного кабинета УК» — про соседей
 * и про управляющую компанию, которых у частного дома не бывает. Пока
 * веток две в двух местах, они расходятся; здесь они одни.
 */
export function waitingHint(p) {
  if (p.deciders?.chairman) {
    return 'Доступ к дому и соседям подтверждает председатель совета дома';
  }
  if (p.deciders?.dispatcher) {
    return 'У дома пока нет председателя — попросите УК его назначить';
  }
  if (p.houseManagement?.form === 'private') {
    return 'Свой дом: подтверждать некому и нечего. Если вы живёте здесь '
      + 'не один, попросите хозяина прислать код приглашения';
  }
  if (p.houseClaimAt) {
    return 'Заявка на подключение дома подана — мы разберём её вручную';
  }
  return 'У дома пока нет ни председателя, ни кабинета управляющей организации';
}

/**
 * Содержимое шторки «ожидает».
 *
 * ПОЧЕМУ ШТОРКА. До 15 сентября это стояло на главной двумя карточками
 * над оплатой — при каждом входе, хотя нужно в основном один раз.
 * Главная ожидающего жителя выглядела перегруженной ровно тогда, когда
 * человек впервые в неё попадает. Теперь пометка «ожидает» в шапке
 * открывает этот лист.
 *
 * Ничего не убрано: «Проверить» и код приглашения достижимы в одно
 * касание. Без них человек застревал — это находки аудита 11 сентября.
 * Поле кода носит те же id, что и на экране входа: обработчик в main.js
 * один на оба места.
 */
export function pendingSheetMarkup(p) {
  return html`
    <div class="meter-name">Заявка ждёт подтверждения</div>
    <div class="dt-p" style="font-size:15px;color:var(--tx-2);margin-top:6px">
      ${waitingText(p)}
    </div>
    <div class="dt-p" style="font-size:14px;color:var(--tx-2)">
      ${p.houseManagement?.orgHasCabinet
        ? 'Начисления, счётчики, аналитика и обращение в управляющую компанию работают уже сейчас.'
        : 'Начисления, счётчики, аналитика и обращение работают уже сейчас — запись сохранится, даже если адресата пока нет.'}
    </div>
    <div class="field-error" id="pendingStatus"></div>
    <button class="btn-primary secondary" data-action="check-access">Проверить</button>

    <div class="field-label" style="margin-top:22px">Есть код от собственника?</div>
    <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:0">
      Если собственник прислал вам код приглашения, введите его — квитанция не нужна.
    </div>
    <input type="text" id="inviteCode" placeholder="Например, K7MD9P"
           autocomplete="off" autocapitalize="characters"
           style="letter-spacing:.16em;text-transform:uppercase">
    <div class="field-error" id="inviteErr"></div>
    <button class="btn-primary secondary" data-action="redeem-invite">Войти по коду</button>`;
}

export function waitingText(p) {
  if (p.deciders?.chairman) {
    return `Доступ к дому и соседям подтверждает председатель совета дома.
            Сканировать квитанцию заново не нужно — мы вас запомнили.`;
  }
  // `dispatcher` здесь значит «у организации есть свой кабинет» —
  // а не просто «организация известна» (см. decidersForHouse)
  if (p.deciders?.dispatcher) {
    return `У дома пока нет председателя, и подтвердить доступ к соседям
            некому. Попросите управляющую компанию его назначить —
            это делается один раз.`;
  }

  /**
   * У частного дома соседей нет по определению: дом и квартира — один
   * и тот же объект, и раздел «Дом» у него не показывается вовсе.
   * Обещать ему «доступ к соседям» значит обещать пустоту.
   */
  if (p.houseManagement?.form === 'private') {
    return `Свои квитанции, счётчики и обращение работают уже сейчас —
            подтверждения они не ждут.`;
  }

  return html`
    У дома пока нет ни председателя, ни доступного кабинета управляющей
    организации — подтвердить доступ к соседям некому.
    ${askOperatorBlock(p, { indent: true })}`;
}

/**
 * Приглашение подключить дом — одним куском на оба места, где оно нужно.
 *
 * Раньше разметка и объяснение были скопированы в карточке ожидания
 * и здесь: два одинаковых блока, которые обязаны меняться синхронно,
 * иначе тексты разъедутся.
 *
 * Дом без УК и без председателя — тупик, из которого сам житель выйти
 * не может. Кнопка появляется, только когда просить больше некого:
 * `canAskOperator` уже учитывает и председателя, и организацию,
 * и частный дом.
 */
export function askOperatorBlock(p, { indent = false } = {}) {
  if (!p.houseManagement?.canAskOperator) return '';

  const style = `font-size:14px;color:var(--tx-2)${indent ? ';margin-top:10px' : ''}`;

  /**
   * Заявка уже подана — тогда это СОСТОЯНИЕ, а не кнопка.
   *
   * Пока `/api/me` о поданной заявке молчал, экран после нажатия
   * не менялся ни на букву: тот же текст, та же кнопка, и единственным
   * следом был тост, исчезающий за секунды. Человек читал «это делается
   * один раз» и видел кнопку, которую уже нажимал. Проверено на живом
   * стенде 11 сентября.
   */
  if (p.houseClaimAt) {
    return html`
      <div class="dt-p" style="${style}">
        Заявка на подключение дома подана ${esc(formatDate(p.houseClaimAt))}.
        Мы разберём её вручную и пришлём ответ — повторять не нужно.
      </div>`;
  }

  /**
   * Организация может быть известна, а кабинета у неё не быть.
   *
   * Прежний текст «за вашим домом не закреплена ни управляющая компания,
   * ни председатель» показывался и в этом случае — в трёх сантиметрах
   * от строки, где та же компания названа по имени. Проверено вживую:
   * приложение на одном экране называло УК и отрицало её.
   */
  return html`
    <div class="dt-p" style="${style}">
      ${p.houseManagement.orgName
        ? html`За домом закреплена «${esc(p.houseManagement.orgName)}», но кабинета
               в сервисе у неё пока нет, а председателя у дома ещё не выбрали.
               Расскажите о доме — мы подключим его вручную.`
        : `За вашим домом не закреплена ни управляющая компания, ни
           председатель. Расскажите о доме — мы подключим его вручную.`}
      Это делается один раз.
    </div>
    <button class="btn-primary" ${indent ? 'style="margin-top:10px"' : ''}
            data-action="ask-operator" data-id="${esc(p.propertyId)}">
      Подключить дом
    </button>`;
}
