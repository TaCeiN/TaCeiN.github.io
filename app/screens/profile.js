import { api } from '../api.js';
import { platform } from '../platform.js';
import {
  esc, html, money, formatDate, errorState, emptyState, toast, withLoading, plural,
} from '../ui.js';
import { readTheme, applyTheme } from '../theme.js';
import { activePropertyStore } from '../config.js';
import { shortAddress, propertyTitle, waitingText } from './home.js';

/**
 * Профиль, адреса, доступ к адресу, оплата и аварийные службы.
 *
 * Экран профиля — единственное место, где человек видит, что приложение
 * про него знает и кто ещё видит его начисления. Поэтому список жильцов
 * адреса и кнопка отзыва доступа живут здесь, а не спрятаны в настройках.
 */

/* ─────────────── профиль ─────────────── */

export function renderProfile(state) {
  const { me } = state;
  const user = me?.user;
  const theme = readTheme();

  return html`
    <div class="profile-head">
      <div class="profile-avatar">${esc(initials(user?.name))}</div>
      <div class="profile-name">${esc(user?.name ?? 'Житель')}</div>
      <div class="profile-sub">
        ${state.currentProperty
          // Активная собственность, а не первая в списке: под именем должно
          // стоять то же, что стоит в шапке главной
          ? esc(propertyTitle(state.currentProperty))
          : 'Адрес не привязан'}
      </div>
    </div>

    <div class="field-label">Оформление</div>
    <div class="segmented" id="themeSeg">
      ${[['system', 'Как в MAX'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([v, label]) => html`
        <button class="${theme === v ? 'on' : ''}" data-action="set-theme" data-v="${v}">
          ${esc(label)}
        </button>`).join('')}
    </div>

    <div class="field-label">Моя недвижимость</div>
    <div class="list">
      ${me.properties.map((p) => html`
        <button class="row tappable" data-action="properties">
          <span class="sq"><svg viewBox="0 0 20 20" fill="none"><path d="M3 8.5L10 3L17 8.5V16.5H3V8.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>
          <div class="content">
            <div class="t">${esc(propertyTitle(p))}</div>
            <div class="d">${esc(accountsLine(p))}</div>
          </div>
          ${statusPill(p)}
        </button>`).join('')}
    </div>
    <button class="btn-primary secondary" data-action="properties">Вся недвижимость</button>

    <div class="field-label">Доступ и данные</div>
    <div class="list">
      ${state.chairman?.isChairman
        ? row('council', 'Совет дома',
            esc(state.chairman.houses[0]?.houseLabel ?? 'Подтверждение жильцов, объявления, опросы'))
        : ''}
      ${row('access', 'Кто видит мой адрес', 'Домочадцы и запросы доступа')}
      ${row('notifications', 'Уведомления', notificationsHint())}
      ${row('privacy', 'Персональные данные', 'Что мы храним и как это удалить')}
    </div>

    <div class="profile-sub" style="margin-top:20px;text-align:center">
      ${user?.viaMax ? 'Вход через MAX' : 'Вход по QR квитанции'}
      ${user?.phoneVerified ? ' · телефон подтверждён' : ''}
    </div>

    <button class="link-btn" data-action="logout">Выйти</button>`;
}

function row(action, title, hint) {
  return html`
    <button class="row tappable" data-action="${esc(action)}">
      <div class="content">
        <div class="t">${esc(title)}</div>
        <div class="d">${esc(hint)}</div>
      </div>
      <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>`;
}

function notificationsHint() {
  return platform.inMax
    ? 'Приходят сообщением от бота в MAX'
    : 'В браузере уведомления не приходят — откройте приложение в MAX';
}

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const [surname, first] = parts;
  return ((first?.[0] ?? '') + (surname?.[0] ?? '')).toUpperCase() || '?';
}

/* ─────────────── адреса ─────────────── */

/**
 * Строка «метка — значение» в списке.
 *
 * Функция вызывалась на экране начислений, но не существовала: экран падал
 * с «infoRow is not defined» и показывал «Не удалось загрузить» вместо
 * реквизитов. Ошибка была не видна в тестах, потому что верстку они
 * не исполняют.
 */
function infoRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return html`
    <div class="row">
      <div class="content">
        <div class="d">${esc(label)}</div>
        <div class="t" style="margin-top:2px">${esc(value)}</div>
      </div>
    </div>`;
}

/** Человеческие названия услуг: коды наружу не показываем. */
const SERVICE_LABEL = {
  housing: 'ЖКУ',
  electricity: 'Электроэнергия',
  gas: 'Газ',
  water: 'Вода',
  heat: 'Отопление',
  waste: 'Вывоз мусора',
  overhaul: 'Капремонт',
  other: 'Прочее',
};

/**
 * Подпись под адресом.
 *
 * У квартиры несколько лицевых счетов, и раньше каждый был отдельным
 * «адресом» в списке: одна квартира выглядела как четыре. Теперь адрес
 * один, а под ним перечислены услуги.
 */
function accountsLine(p) {
  const accounts = p.accounts ?? [];
  if (accounts.length === 0) return p.ukName ?? '';

  const names = accounts.map((a) => SERVICE_LABEL[a.service] ?? 'Прочее');
  return names.length <= 3
    ? names.join(' · ')
    : `${names.slice(0, 2).join(' · ')} и ещё ${names.length - 2}`;
}

/**
 * Пометка статуса. Ожидающий объект называется своим словом: он уже
 * в списке, и без пометки человек решит, что доступ уже открыт.
 */
function statusPill(p) {
  if (p.status === 'pending') return '<span class="pill new">ожидает</span>';
  return html`<span class="pill ${p.role === 'owner' ? 'ok' : ''}">
    ${p.role === 'owner' ? 'собственник' : 'жилец'}
  </span>`;
}

export function renderProperties(state) {
  const { me } = state;
  const currentId = state.currentProperty?.propertyId;

  /**
   * Ожидающие объекты стоят в общем списке, поэтому отдельным блоком
   * показываем только ОТКЛОНЁННЫЕ заявки: они из `properties` уходят,
   * а причина отказа человеку нужна — иначе непонятно, что делать.
   */
  const rejected = (me.myPendingAccess ?? []).filter((p) => p.status === 'revoked');

  return html`
    <div class="list">
      ${me.properties.map((p) => html`
        <div class="row prop-row">
          <button class="prop-pick" data-action="pick-property" data-id="${esc(p.propertyId)}">
            <span class="sq ${p.propertyId === currentId ? 'new' : ''}">
              ${p.propertyId === currentId
                ? '<svg viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                : '<svg viewBox="0 0 20 20" fill="none"><path d="M3 8.5L10 3L17 8.5V16.5H3V8.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'}
            </span>
            <div class="content">
              <div class="t">${esc(propertyTitle(p))}</div>
              <div class="d">
                ${esc(accountsLine(p))}
                ${p.bill?.sumKopecks != null ? ` · ${esc(money(p.bill.sumKopecks))}` : ''}
              </div>
              ${p.status === 'pending' ? html`
                <div class="d" style="color:var(--amber-deep)">
                  ${p.deciders?.chairman
                    ? 'Доступ к дому и соседям подтверждает председатель совета дома'
                    : p.deciders?.dispatcher
                      ? 'У дома пока нет председателя — попросите УК его назначить'
                      : 'Дома пока нет в реестре управляющих организаций'}
                </div>` : ''}
              ${p.addressSource === 'resident' ? `
                <div class="d" style="color:var(--amber-deep)">
                  Адрес указали вы — управляющая компания ещё не сверила его
                  с лицевым счётом
                </div>` : ''}
            </div>
          </button>
          ${statusPill(p)}
          <button class="prop-more" data-action="open-property"
                  data-id="${esc(p.propertyId)}" aria-label="Подробнее об объекте">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`).join('')}
    </div>

    ${rejected.length ? html`
      <div class="field-label">Отклонённые заявки</div>
      <div class="list">
        ${rejected.map((p) => html`
          <div class="row">
            <div class="content">
              <div class="t">Заявка отклонена</div>
              <div class="d">${esc(p.rejectReason ?? 'Причина не указана')}</div>
            </div>
            <span class="pill">отказ</span>
          </div>`).join('')}
      </div>` : ''}

    <button class="btn-primary" data-action="add-property">Добавить недвижимость</button>

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Квитанции за свет, газ и вывоз мусора добавляются внутри самой квартиры:
      откройте её стрелкой справа. «Добавить недвижимость» — это новый адрес,
      для него понадобится квитанция по нему.
    </div>`;
}

/* ─────────────── доступ к адресу ─────────────── */

export async function renderAccess(state) {
  const property = state.currentProperty;
  if (!property) return emptyState('Адрес не привязан', 'Отсканируйте квитанцию');

  /**
   * Состав жильцов — данные ДРУГИХ людей, это уровень 1. Пока доступ
   * не подтверждён, показывать нечего, и сказать об этом надо словами.
   */
  if (property.status === 'pending') {
    return html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Раздел откроется после подтверждения</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${waitingText(property)}
        </div>
      </div>`;
  }

  let data;
  try {
    data = await api.household(property.propertyId);
  } catch (error) {
    return errorState(error, 'access');
  }

  // Запросы доступа приходят на все объекты сразу — на этом экране
  // показываем только те, что относятся к открытому адресу
  const pending = (state.me.pendingRequests ?? [])
    .filter((p) => p.propertyId === property.propertyId);

  return html`
    <div class="dt-meta" style="margin-top:0">${esc(shortAddress(property))}</div>

    ${pending.length ? html`
      <div class="field-label">Просят доступ</div>
      <div class="list">
        ${pending.map((p) => html`
          <div class="row">
            <span class="sq new"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7.5" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 17C4.5 13.8 7 12.4 10 12.4C13 12.4 15.5 13.8 15.5 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
            <div class="content">
              <div class="t">${esc(p.claimedName || p.requesterName)}</div>
              <div class="d">
                ${p.claimedNote
                  ? esc(p.claimedNote)
                  : 'Отсканировал квитанцию этого адреса'}
              </div>
            </div>
            <button class="pay-quickbtn tappable" style="background:var(--accent);color:#fff"
                    data-action="approve" data-id="${esc(p.bindingId)}">Разрешить</button>
            <button class="pay-quickbtn tappable" style="background:var(--fade);color:var(--negative)"
                    data-action="reject" data-id="${esc(p.bindingId)}">Отклонить</button>
          </div>`).join('')}
      </div>` : ''}

    <div class="field-label">Сейчас имеют доступ</div>
    <div class="list">
      ${data.members.map((m) => html`
        <div class="row">
          <span class="sq ${m.role === 'owner' ? 'ok' : ''}">
            <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7.5" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 17C4.5 13.8 7 12.4 10 12.4C13 12.4 15.5 13.8 15.5 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
          <div class="content">
            <div class="t">${esc(m.name)}${m.isMe ? ' — это вы' : ''}</div>
            <div class="d">
              ${m.role === 'owner' ? 'Собственник' : 'Жилец'}
              ${m.status === 'invited' ? ' · ждёт подтверждения' : ''}
              ${m.since ? ` · с ${esc(formatDate(m.since))}` : ''}
            </div>
          </div>
          ${data.canManage && !m.isMe && m.role !== 'owner' ? html`
            <button class="pay-quickbtn tappable" style="background:var(--fade);color:var(--negative)"
                    data-action="revoke" data-id="${esc(m.bindingId)}">Отозвать</button>` : ''}
        </div>`).join('')}
    </div>

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Чтобы дать доступ близкому, покажите ему квитанцию — он сканирует
      тот же QR и попадает сюда как жилец. Отдельного приглашения не нужно.
      ${data.canManage
        ? ' Отзыв доступа действует сразу: вход с его устройства перестанет работать.'
        : ''}
    </div>`;
}

/* ─────────────── начисления ─────────────── */

/**
 * Экран начислений.
 *
 * Ключевая честность: приложение НЕ знает, прошёл ли платёж. В платёжном
 * QR такой информации нет, доступа к биллингу УК и к ГИС ЖКХ у нас тоже
 * нет. Поэтому статус подписан «отмечено вами», а расчётная сумма нигде
 * не названа задолженностью перед управляющей компанией.
 */
export async function renderPayment(state) {
  const property = state.currentProperty;
  if (!property) return emptyState('Адрес не привязан', 'Отсканируйте квитанцию');

  let data;
  try {
    data = await api.bills(property.propertyId);
  } catch (error) {
    return errorState(error, 'payment');
  }

  const nothingOwed = data.outstandingKopecks === 0;

  return html`
    <div class="dt-card">
      <div class="pay-label">
        ${nothingOwed ? 'Непогашенных начислений нет' : 'Не отмечено оплаченным'}
      </div>
      <div class="pay-amt" style="${data.overdueCount ? 'color:var(--negative)' : ''}">
        ${esc(data.outstanding)}
      </div>
      <div class="pay-card-bottom">
        <span class="pay-due">
          ${data.overdueCount
            ? `${data.overdueCount} ${plural(data.overdueCount, 'период', 'периода', 'периодов')} с истёкшим сроком`
            : `по всем счетам квартиры: ${esc((property.accounts ?? []).length)}`}
        </span>
      </div>
    </div>

    <div class="warn-line" style="margin-top:12px">${esc(data.disclaimer)}</div>

    <div class="field-label">История начислений</div>
    ${data.bills.length === 0
      ? emptyState('Начислений нет', 'Отсканируйте квитанцию — она попадёт в историю')
      : `<div class="list">${data.bills.map(billRow).join('')}</div>`}

    <div class="field-label">Лицевые счета этой квартиры</div>
    <div class="list">
      ${(property.accounts ?? []).length
        ? property.accounts.map((a) => html`
            <div class="row">
              <div class="content">
                <div class="t">${esc(SERVICE_LABEL[a.service] ?? 'Прочее')}</div>
                <div class="d">${esc(a.provider ?? '')} · счёт ${esc(a.persAcc)}</div>
              </div>
            </div>`).join('')
        : infoRow('Лицевые счета', 'нет')}
    </div>

    <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
      За квартиру платят нескольким организациям: ЖКУ, свет, газ, вывоз мусора.
      Отсканируйте каждую квитанцию — все они добавятся к одному адресу.
    </div>

    <button class="btn-primary secondary" data-action="add-property">
      Добавить квитанцию
    </button>

    <div class="field-label">Об объекте</div>
    <div class="list">
      ${infoRow('Обслуживает дом', property.ukName
        ?? 'дома нет в реестре управляющих организаций')}
      ${property.ukPhone ? infoRow('Телефон УК', property.ukPhone) : ''}
      ${infoRow('Адрес', property.addressRaw)}
      ${property.addressSource === 'resident'
        ? infoRow('Источник адреса', 'указан вами, ждёт сверки с УК')
        : property.addressSource === 'uk'
          ? infoRow('Источник адреса', 'подтверждён управляющей компанией')
          : ''}
    </div>

    <div class="dt-card" style="margin-top:16px">
      <div class="meter-name">Оплатить можно по тому же QR</div>
      <div class="dt-p" style="color:var(--tx-2);font-size:14px;margin-top:8px">
        Наведите камеру банковского приложения на код с квитанции — реквизиты
        подставятся сами. Приём платежей внутри приложения требует договора
        с банком и регистрации в ГИС ЖКХ, это следующий шаг после пилота с УК.
      </div>
    </div>`;
}

function billRow(b) {
  const tone = b.status === 'paid' ? 'ok' : b.status === 'overdue' ? 'bad' : '';
  const paid = b.status === 'paid';

  return html`
    <div class="row">
      <span class="sq ${tone}">
        ${paid
          ? '<svg viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/><path d="M10 6V10.4M10 13.6V13.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'}
      </span>
      <div class="content">
        <div class="t">
          ${esc(b.serviceLabel ?? '')} · ${esc(b.sum)}
        </div>
        <div class="d">
          ${esc(capitaliseFirst(b.periodLabel))} · ${esc(b.statusLabel)}${paid && b.paidAt ? ` · ${esc(formatDate(b.paidAt))}` : ''}
        </div>
        <div class="d">${esc(b.provider ?? '')}</div>
      </div>
      <button class="pay-quickbtn tappable"
              style="${paid ? '' : 'background:var(--accent);color:#fff'}"
              data-action="mark-paid" data-id="${esc(b.id)}" data-paid="${paid ? '0' : '1'}">
        ${paid ? 'Снять' : 'Оплатил'}
      </button>
    </div>`;
}

function capitaliseFirst(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

/* ─────────────── аварийные службы ─────────────── */

const EMERGENCY = [
  { title: 'Аварийная служба УК', hint: 'Круглосуточно', phone: '+7 495 000-00-00' },
  { title: 'Единая служба спасения', hint: 'Пожар, газ, угроза жизни', phone: '112' },
  { title: 'Аварийная газовая служба', hint: 'Запах газа', phone: '104' },
];

export function renderEmergency(state) {
  return html`
    <div class="dt-p" style="margin-top:2px">
      Если есть угроза жизни, залив соседей или запах газа — звоните,
      а заявку в приложении оформите потом.
    </div>

    <div class="list" style="margin-top:14px">
      ${EMERGENCY.map((e) => html`
        <button class="row tappable" data-action="call" data-phone="${esc(e.phone)}">
          <span class="sq bad-soft">
            <svg viewBox="0 0 20 20" fill="none"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H7L8.2 7L6.8 8.2C7.6 10 9 11.4 10.8 12.2L12 10.8L15 12V13.5C15 14.3 14.3 15 13.5 15C8.3 15 4 10.7 4 5.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </span>
          <div class="content">
            <div class="t">${esc(e.title)}</div>
            <div class="d">${esc(e.hint)} · ${esc(e.phone)}</div>
          </div>
        </button>`).join('')}
    </div>

    <button class="btn-primary" data-action="complaint" style="margin-top:16px">
      Оформить аварийную заявку
    </button>`;
}

/* ─────────────── персональные данные ─────────────── */

export function renderPrivacy() {
  return html`
    <div class="dt-title">Что мы храним</div>
    <div class="dt-p">
      Из квитанции: ваше ФИО, адрес, лицевой счёт, сумму начисления и период.
      Из приложения: текст заявок, показания счётчиков и оценки работы.
      Если вход через MAX — идентификатор аккаунта и имя.
    </div>

    <div class="field-label">Кто это видит</div>
    <div class="dt-p" style="margin-top:0">
      Диспетчер управляющей компании видит ваши заявки и адрес — иначе он
      не сможет прислать мастера. Соседи видят только те объявления, которые
      вы разместили сами, и имя под ними. Начисления не видит никто, кроме
      жильцов вашего адреса.
    </div>

    <div class="field-label">Как удалить</div>
    <div class="dt-p" style="margin-top:0">
      Напишите в управляющую компанию — данные удалят вместе с привязкой
      к лицевому счёту. В демоверсии эта кнопка ещё не подключена: удаление
      затрагивает данные УК и должно проходить по их регламенту.
    </div>`;
}

/* ─────────────── действия ─────────────── */

export async function handleProfileAction(action, target, ctx) {
  switch (action) {
    case 'set-theme': {
      applyTheme(target.dataset.v);
      target.parentElement.querySelectorAll('button')
        .forEach((b) => b.classList.toggle('on', b === target));
      return true;
    }

    case 'pick-property': {
      const id = target.dataset.id;
      const found = ctx.state.me.properties.find((p) => p.propertyId === id);
      if (found) {
        ctx.state.currentProperty = found;
        // Выбор переживает перезапуск: иначе человек возвращается к первой
        activePropertyStore.set(ctx.state.me.user?.id, id);
        platform.haptic('light');
      }
      await ctx.reset('home');
      return true;
    }

    case 'open-property':
      await ctx.show('property', { id: target.dataset.id });
      return true;

    case 'add-property':
      await ctx.show('add-property');
      return true;

    case 'revoke': {
      await withLoading(target, async () => {
        try {
          await api.revokeAccess(target.dataset.id);
          platform.haptic('medium');
          toast('Доступ отозван');
          await ctx.refresh();
        } catch (error) {
          toast(error.message);
        }
      });
      return true;
    }

    case 'mark-paid': {
      await withLoading(target, async () => {
        try {
          await api.markPaid(target.dataset.id, target.dataset.paid === '1');
          platform.haptic('light');
          await ctx.refresh();
        } catch (error) {
          toast(error.message);
        }
      });
      return true;
    }

    case 'privacy':
      await ctx.show('privacy');
      return true;

    default:
      return false;
  }
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function periodName(period) {
  const [, month] = String(period).split('-');
  return MONTHS[Number(month) - 1] ?? period;
}
