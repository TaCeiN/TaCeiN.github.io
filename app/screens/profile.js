import { api } from '../api.js';
import { platform } from '../platform.js';
import {
  esc, html, money, formatDate, errorState, emptyState, toast, withLoading,
} from '../ui.js';
import { readTheme, applyTheme } from '../theme.js';
import { shortAddress } from './home.js';

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
        ${me.properties.length
          ? esc(shortAddress(me.properties[0]))
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

    <div class="field-label">Мои адреса</div>
    <div class="list">
      ${me.properties.map((p) => html`
        <button class="row tappable" data-action="properties">
          <span class="sq"><svg viewBox="0 0 20 20" fill="none"><path d="M3 8.5L10 3L17 8.5V16.5H3V8.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>
          <div class="content">
            <div class="t">${esc(shortAddress(p))}</div>
            <div class="d">${esc(p.ukName ?? '')} · счёт ${esc(p.persAcc)}</div>
          </div>
          <span class="pill ${p.role === 'owner' ? 'ok' : ''}">
            ${p.role === 'owner' ? 'собственник' : 'жилец'}
          </span>
        </button>`).join('')}
    </div>
    <button class="btn-primary secondary" data-action="add-property">Добавить адрес</button>

    <div class="field-label">Доступ и данные</div>
    <div class="list">
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

export function renderProperties(state) {
  const { me } = state;
  const currentId = state.currentProperty?.propertyId;

  return html`
    <div class="list">
      ${me.properties.map((p) => html`
        <button class="row tappable" data-action="pick-property" data-id="${esc(p.propertyId)}">
          <span class="sq ${p.propertyId === currentId ? 'new' : ''}">
            ${p.propertyId === currentId
              ? '<svg viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>'
              : '<svg viewBox="0 0 20 20" fill="none"><path d="M3 8.5L10 3L17 8.5V16.5H3V8.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'}
          </span>
          <div class="content">
            <div class="t">${esc(shortAddress(p))}</div>
            <div class="d">
              ${esc(p.ukName ?? '')}
              ${p.bill?.sumKopecks != null ? ` · ${esc(money(p.bill.sumKopecks))}` : ''}
            </div>
          </div>
        </button>`).join('')}
    </div>

    ${me.myPendingAccess?.length ? html`
      <div class="field-label">Ждут подтверждения собственника</div>
      <div class="list">
        ${me.myPendingAccess.map((p) => html`
          <div class="row">
            <div class="content">
              <div class="t">${esc(p.addressRaw ?? '')}</div>
              <div class="d">Собственник ещё не подтвердил доступ</div>
            </div>
            <span class="pill">ожидает</span>
          </div>`).join('')}
      </div>` : ''}

    <button class="btn-primary" data-action="add-property">Добавить адрес по квитанции</button>

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Каждый адрес добавляется сканированием его квитанции. Если лицевой счёт
      уже занят, доступ подтверждает собственник.
    </div>`;
}

/* ─────────────── доступ к адресу ─────────────── */

export async function renderAccess(state) {
  const property = state.currentProperty;
  if (!property) return emptyState('Адрес не привязан', 'Отсканируйте квитанцию');

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
              <div class="t">${esc(p.requesterName)}</div>
              <div class="d">Отсканировал квитанцию этого адреса</div>
            </div>
            <button class="pay-quickbtn tappable" style="background:var(--accent);color:#fff"
                    data-action="approve" data-id="${esc(p.bindingId)}">Разрешить</button>
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

/* ─────────────── оплата ─────────────── */

export function renderPayment(state) {
  const property = state.currentProperty;
  const bill = property?.bill;

  return html`
    <div class="dt-card">
      <div class="pay-label">
        ${bill?.period ? `Начисление за ${esc(periodName(bill.period))}` : 'Начислений нет'}
      </div>
      <div class="pay-amt">${bill?.sumKopecks != null ? esc(money(bill.sumKopecks)) : '—'}</div>
      <div class="pay-card-bottom">
        <span class="pay-due">${esc(property?.ukName ?? '')}</span>
      </div>
    </div>

    <div class="field-label">Реквизиты из квитанции</div>
    <div class="list">
      ${infoRow('Лицевой счёт', property?.persAcc)}
      ${infoRow('Адрес', property?.addressRaw)}
      ${infoRow('Период', bill?.period ? periodName(bill.period) : null)}
    </div>

    <div class="dt-card" style="margin-top:16px">
      <div class="meter-name">Оплата пока не подключена</div>
      <div class="dt-p" style="color:var(--tx-2);font-size:14px;margin-top:8px">
        Приём платежей требует договора с банком или платёжным агрегатором
        и регистрации в ГИС ЖКХ. Это следующий шаг после пилота с УК — сейчас
        приложение показывает начисление и хранит историю, а платить можно
        по тому же QR в приложении банка.
      </div>
    </div>`;
}

function infoRow(title, value) {
  if (!value) return '';
  return html`
    <div class="row">
      <div class="content">
        <div class="d">${esc(title)}</div>
        <div class="t" style="margin-top:2px">${esc(value)}</div>
      </div>
    </div>`;
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
        platform.haptic('light');
      }
      await ctx.reset('home');
      return true;
    }

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
