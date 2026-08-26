import { api } from '../api.js';
import {
  esc, html, formatDate, toast, withLoading, emptyState, errorState,
} from '../ui.js';

/**
 * Совет дома — РАЗДЕЛ, а не второй профиль.
 *
 * ПОЧЕМУ НЕ РЕЖИМ. Председатель — такой же житель этого дома, и раньше
 * у него был отдельный веб-кабинет со своим логином и паролем. Второй
 * аккаунт заставляет человека помнить, «под кем он сейчас», а в советах
 * домов большинство — люди старшего возраста, для которых это худший вид
 * путаницы: нажал что-то, всё выглядит иначе, и непонятно, как вернуть.
 *
 * Поэтому здесь нет ни переключателя профилей, ни цветной шапки «вы
 * в режиме председателя», ни кнопки «выйти из режима». Это обычный экран
 * с обычной кнопкой «Назад» — как «Мои адреса» или «Аварийные службы».
 *
 * Вход в него — из карточки на главной (появляется, когда есть что
 * разобрать) и из профиля.
 */

const PAYMENT_LABEL = {
  paid: 'оплачено',
  due: 'к оплате',
  overdue: 'срок прошёл',
  unknown: 'начислений нет',
};

const PAYMENT_TONE = {
  paid: 'ok',
  due: '',
  overdue: 'bad',
  unknown: '',
};

export function councilSkeleton() {
  return html`<div class="page active" id="page-council"></div>`;
}

/** Главный экран раздела: что требует внимания, потом дом. */
export async function renderCouncil(state) {
  let me;
  try {
    me = await api.chairmanMe();
  } catch (error) {
    return errorState(error, 'reload');
  }

  if (!me.isChairman) {
    return emptyState(
      'Вы не председатель совета дома',
      'Председателя назначает управляющая компания',
    );
  }

  const house = me.houses[0];
  state.council = { house };

  const claims = (await api.chairmanClaims().catch(() => ({ claims: [] }))).claims;
  const summary = await api.chairmanHouse().catch(() => null);

  return html`
    <div class="dt-title" style="margin-top:0">${esc(house.houseLabel)}</div>
    <div class="dt-meta">Совет дома</div>

    ${summary ? html`
      <div class="stats" style="margin-top:14px">
        <div class="stat">
          <div class="n">${summary.totals.flats}</div><div class="l">Квартир</div>
        </div>
        <div class="stat">
          <div class="n">${summary.totals.registered}</div><div class="l">В приложении</div>
        </div>
        <div class="stat ${claims.length ? 'warn' : ''}">
          <div class="n">${claims.length}</div><div class="l">Ждут решения</div>
        </div>
      </div>` : ''}

    <div class="field-label">Заявки на доступ</div>
    ${claims.length === 0
      ? html`<div class="dt-p" style="margin-top:0;color:var(--tx-2)">
          Никто не ждёт подтверждения.
        </div>`
      : html`
        <div class="dt-p" style="margin-top:0;font-size:13px;color:var(--tx-2)">
          Подтверждайте только тех, кого узнаёте. Квитанция ничего
          не доказывает — её строку можно набрать руками.
        </div>
        <div class="list">${claims.map(claimRow).join('')}</div>`}

    <div class="s-label"><h2>Дом</h2></div>
    <div class="services">
      <button class="svc c2" data-action="council-house">
        <span class="ic">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 9L11 3.5L18 9V18H4V9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 18V12H14V18" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </span>
        <span class="label">Квартиры дома</span>
      </button>
      <button class="svc c4" data-action="council-posts">
        <span class="ic"><i class="svc-icon" style="--svc-icon:url('icons/services/feed.svg')"></i></span>
        <span class="label">Объявления</span>
      </button>
      <button class="svc c3" data-action="council-polls">
        <span class="ic"><i class="svc-icon" style="--svc-icon:url('icons/services/polls.svg')"></i></span>
        <span class="label">Опросы</span>
      </button>
    </div>`;
}

function claimRow(c) {
  const mismatch = c.claimedFlat && c.flat && c.claimedFlat !== c.flat;

  return html`
    <div class="row">
      <span class="sq ${c.complete ? 'new' : ''}">
        <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7.5" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 17C4.5 13.8 7 12.4 10 12.4C13 12.4 15.5 13.8 15.5 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </span>
      <div class="content">
        <div class="t">${esc(c.claimedName || c.accountName)}</div>
        <div class="d">
          Квартира ${esc(c.claimedFlat || c.flat || '—')}
          ${mismatch ? ` · в квитанции ${esc(c.flat)} — переспросите` : ''}
        </div>
        ${c.note ? html`<div class="d">${esc(c.note)}</div>` : ''}
        <div class="d" style="font-size:12px">
          ${c.viaMax ? 'Вход через MAX' : 'Вход из браузера'}
          ${c.phoneVerified ? ' · телефон подтверждён' : ''}
          · ${esc(formatDate(c.requestedAt))}
        </div>

        ${c.complete ? html`
          <div class="chips" style="margin-top:10px">
            <span class="chip" data-action="claim-owner" data-id="${esc(c.bindingId)}">
              Собственник
            </span>
            <span class="chip" data-action="claim-member" data-id="${esc(c.bindingId)}">
              Жилец
            </span>
            <span class="chip" data-action="claim-reject" data-id="${esc(c.bindingId)}">
              Отказать
            </span>
          </div>`
          : html`<div class="d" style="color:var(--amber-deep)">
              Ждём, пока человек расскажет о себе
            </div>`}
      </div>
    </div>`;
}

/**
 * Квартиры дома: кто живёт, лицевые счета, оплата, счётчики.
 *
 * ОПЛАТА ПОКВАРТИРНО, БЕЗ ФИО. Кто именно не заплатил, председателю знать
 * не нужно: «кв. 27 не оплачена» для разговора хватает, а оператор
 * персональных данных — управляющая компания, не он.
 */
export async function renderCouncilHouse(state) {
  let data;
  try {
    data = await api.chairmanHouse();
  } catch (error) {
    return errorState(error, 'reload');
  }

  state.councilHouse = data;

  return html`
    <div class="dt-title" style="margin-top:0">${esc(data.address)}</div>
    <div class="dt-meta">${data.totals.flats} квартир · ${data.totals.registered} в приложении</div>

    <div class="stats" style="margin-top:14px">
      <div class="stat"><div class="n">${data.totals.paid}</div><div class="l">Оплачено</div></div>
      <div class="stat ${data.totals.overdue ? 'bad' : ''}">
        <div class="n">${data.totals.overdue}</div><div class="l">Срок прошёл</div>
      </div>
      <div class="stat"><div class="n">${data.totals.metersSubmitted}</div><div class="l">Передали показания</div></div>
    </div>

    <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
      ${esc(data.disclaimer)}
    </div>

    <div class="field-label">Квартиры</div>
    ${data.flats.length === 0
      ? emptyState('Пока никого', 'Квартиры появятся, когда жители отсканируют квитанции')
      : html`<div class="list">${data.flats.map(flatRow).join('')}</div>`}`;
}

function flatRow(f) {
  const tone = PAYMENT_TONE[f.payment.state] ?? '';

  return html`
    <div class="row">
      <span class="sq ${tone}">${esc(f.flat || '—')}</span>
      <div class="content">
        <div class="t">
          Квартира ${esc(f.flat || '—')}
          <span class="pill ${tone}">${esc(PAYMENT_LABEL[f.payment.state])}</span>
        </div>

        ${f.residents.length
          ? html`<div class="d">${esc(f.residents.map((r) => r.name).join(', '))}</div>`
          : html`<div class="d" style="color:var(--tx-2)">В приложении никого нет</div>`}

        ${f.accounts.length ? html`
          <div class="d" style="font-size:12px">
            ${esc(f.accounts.map((a) => `${a.persAcc} · ${a.provider}`).join(' · '))}
          </div>` : ''}

        ${f.meters.length ? html`
          <div class="d" style="font-size:12px">
            ${f.meters.map((m) => esc(
              `${m.label}: ${m.lastValue ?? '—'}${m.submittedThisPeriod ? '' : ' (не передано)'}`
              + (m.verificationOverdue ? ' · поверка просрочена' : ''),
            )).join(' · ')}
          </div>` : ''}
      </div>
    </div>`;
}

/** Решения по заявкам и переходы внутри раздела. */
export async function handleCouncilAction(action, target, ctx) {
  if (action === 'council-house') {
    await ctx.go('council-house');
    return true;
  }

  if (action === 'claim-owner' || action === 'claim-member') {
    const role = action === 'claim-owner' ? 'owner' : 'member';
    await withLoading(target, async () => {
      try {
        await api.decideClaim(target.dataset.id, role);
        toast(role === 'owner' ? 'Подтверждён собственником' : 'Подтверждён жильцом');
        await ctx.refresh();
      } catch (error) {
        toast(error.message);
      }
    });
    return true;
  }

  if (action === 'claim-reject') {
    // Причина обязательна: человек должен понимать, что делать дальше
    const reason = window.prompt('Почему отказ? Житель прочитает это в приложении');
    if (!reason || reason.trim().length < 3) return true;

    await withLoading(target, async () => {
      try {
        await api.rejectClaim(target.dataset.id, reason.trim());
        toast('Заявка отклонена');
        await ctx.refresh();
      } catch (error) {
        toast(error.message);
      }
    });
    return true;
  }

  return false;
}
