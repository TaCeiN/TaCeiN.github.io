import { api } from '../api.js';
import {
  esc, html, formatDate, plural, toast, withLoading, emptyState, errorState, eventAuthor,
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

  /**
   * Число обращений, ждущих ответа председателя, приходит вместе
   * с `/api/chairman/me`.
   *
   * Раньше его считали здесь же, на клиенте, — а для этого сюда приезжал
   * весь список обращений дома вместе с последней репликой каждого.
   * Само число нужно было ровно одно, а тянули на телефон всю переписку.
   */
  const awaitingReply = house.awaitingRequests ?? 0;
  // Дом на ТСЖ или непосредственном управлении — обращения адресованы
  // не «в УК», её у дома нет
  const hasUk = house.ukId != null;

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

    <div class="field-label">${hasUk ? 'Обращения в УК' : 'Обращения дома'}</div>
    <div class="list">
      <!--
        Класс — wrow, а не row: подсветку «ход за вами» (.d.ask)
        в styles.css описали только для wrow, у row такого варианта нет,
        и подсветка молча не срабатывала бы.
      -->
      <button class="wrow tappable" data-action="council-requests">
        <span class="sq ${awaitingReply ? 'new' : ''}">
          <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="4.5" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 8.5H13.5M6.5 11.5H11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </span>
        <div class="content">
          <div class="t">Все обращения дома</div>
          <div class="d ${awaitingReply ? 'ask' : ''}">
            ${awaitingReply
              ? `${awaitingReply} ${plural(awaitingReply, 'обращение', 'обращения', 'обращений')}
                 ${plural(awaitingReply, 'ждёт', 'ждут', 'ждут')} ответа`
              : hasUk
                ? 'Переписка с управляющей компанией'
                : 'Переписка по обращениям дома'}
          </div>
        </div>
        <span class="chev">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>
    </div>

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
      <div class="stat"><div class="n">${data.totals.metersSubmitted}</div><div class="l">Записали показания</div></div>
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
              `${m.label}: ${m.lastValue ?? '—'}${m.submittedThisPeriod ? '' : ' (нет записи)'}`
              + (m.verificationOverdue ? ' · поверка просрочена' : ''),
            )).join(' · ')}
          </div>` : ''}
      </div>
    </div>`;
}

/* ─────────────── обращения дома ─────────────── */

const REQUEST_TONE = { done: 'ok', new: 'new', rejected: 'bad' };

/**
 * Список обращений дома.
 *
 * Показываем ВСЕ обращения дома, а не только свежие: архив — это то же
 * доказательство для председателя, что и для самого жителя, и урезать
 * список до «активных» значило бы прятать половину переписки, которую
 * дом уже вёл с УК.
 */
export async function renderCouncilRequests(state) {
  const house = state.council?.house;
  if (!house) return errorState(new Error('Дом не выбран'), 'council');

  let requests;
  try {
    requests = (await api.chairmanRequests(house.houseKey)).requests;
  } catch (error) {
    return errorState(error, 'council');
  }

  return html`
    <div class="dt-title" style="margin-top:0">Обращения дома</div>
    <div class="dt-meta">${esc(house.houseLabel)}</div>

    ${requests.length === 0
      ? emptyState(
          'Обращений пока нет',
          'Здесь появится каждая жалоба и вызов мастера от жителей дома',
        )
      : html`<div class="list" style="margin-top:14px">${requests.map(requestRow).join('')}</div>`}`;
}

function requestRow(r) {
  const tone = REQUEST_TONE[r.status] ?? '';
  const awaiting = !r.closed && r.lastMessage?.actor === 'resident';

  return html`
    <button class="wrow tappable" data-action="council-request" data-id="${esc(r.id)}">
      <span class="sq ${awaiting ? '' : tone}">
        ${awaiting
          ? '<svg viewBox="0 0 20 20" fill="none"><path d="M10 3.2C6.3 3.2 3.3 5.7 3.3 8.8C3.3 10.6 4.3 12.2 5.9 13.2L5.2 16L8.2 14.3C8.8 14.4 9.4 14.5 10 14.5C13.7 14.5 16.7 12 16.7 8.8C16.7 5.7 13.7 3.2 10 3.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 20 20" fill="none"><rect x="3" y="4.5" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 8.5H13.5M6.5 11.5H11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'}
      </span>
      <div class="content">
        <div class="t">${esc(r.title)}</div>
        <div class="d ${awaiting ? 'ask' : ''}">
          Кв. ${esc(r.flat || '—')} · ${esc(r.authorName || 'Житель')}${awaiting ? ' · ждёт ответа' : ''}
        </div>
      </div>
      <span class="pill ${tone}">${esc(r.statusLabel)}</span>
    </button>`;
}

/** Карточка обращения: переписка и вложения, ответ без смены статуса. */
export async function renderCouncilRequestDetail(id, state) {
  const house = state.council?.house;
  if (!house) return errorState(new Error('Дом не выбран'), 'council');

  let r;
  try {
    r = await api.chairmanRequest(id, house.houseKey);
  } catch (error) {
    return errorState(error, 'council-requests');
  }

  return html`
    <div class="dt-title">${esc(r.title)}</div>
    <div class="dt-meta">№ ${esc(r.number)} · ${esc(r.category)} · кв. ${esc(r.flat || '—')}</div>

    <div class="dt-card">
      <div class="dt-status">
        <span class="pill ${REQUEST_TONE[r.status] ?? ''}">${esc(r.statusLabel)}</span>
      </div>
      ${r.slaLabel ? html`
        <div class="sla">${r.closed ? 'Закрыто' : 'Срок реакции'} · ${esc(r.slaLabel)}</div>` : ''}
    </div>

    <div class="field-label">От кого</div>
    <div class="dt-card" style="margin-top:0">
      <div class="dt-p" style="margin-top:0">${esc(r.authorName || 'Житель дома')}</div>
    </div>

    <div class="field-label">Описание</div>
    <div class="dt-card" style="margin-top:0">
      <div class="dt-p" style="margin-top:0">${esc(r.description)}</div>
    </div>

    ${r.rejectReason ? html`
      <div class="field-label">Почему отклонено</div>
      <div class="dt-card"><div class="dt-p" style="margin-top:0">${esc(r.rejectReason)}</div></div>` : ''}

    ${r.photos?.length ? html`
      <div class="field-label">Вложения</div>
      <div class="list">
        ${r.photos.map((f) => html`
          <button class="row tappable" data-action="open-file"
                  data-url="${esc(`/api/chairman/requests/${r.id}/files/${f.id}?houseKey=${encodeURIComponent(house.houseKey)}`)}">
            <span class="sq">
              ${f.mime?.startsWith('image/')
                ? '<svg viewBox="0 0 20 20" fill="none"><rect x="2.5" y="4" width="15" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="8.5" r="1.4" fill="currentColor"/><path d="M3 14L7.5 10.5L11 13L13.5 11L17 14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
                : '<svg viewBox="0 0 20 20" fill="none"><path d="M5 2.5h6.5L15 6v11.5H5V2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11.5 2.5V6H15" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'}
            </span>
            <div class="content">
              <div class="t">${esc(f.name)}</div>
              <div class="d">${esc(fileSize(f.sizeBytes))}</div>
            </div>
          </button>`).join('')}
      </div>` : ''}

    <div class="field-label">Переписка</div>
    <div class="dt-card" style="margin-top:0">
      <div class="timeline">
        ${r.events.map((e) => html`
          <div class="tl-row ${e.actor === 'chairman' ? 'mine' : ''}">
            <div class="tl-dot-col"><div class="tl-dot"></div><div class="tl-line"></div></div>
            <div class="tl-body">
              <div class="tl-who">${esc(eventAuthor(e))}</div>
              <div class="tl-t">${esc(e.text)}</div>
              <div class="tl-time">${esc(formatDate(e.at))}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="dt-card" style="background:var(--fade)">
      <div class="dt-p" style="margin-top:0;font-size:13px;color:var(--tx-2)">
        ${r.hasOrg
          ? `Статус меняет только управляющая компания — совет дома
             отвечает словами.`
          : `Статус здесь менять некому — управляющей компании у вашего
             дома нет. Совет дома может только отвечать словами.`}
        Обращение и переписку нельзя удалить: запись остаётся
        и у жителя, и у вас.
      </div>
    </div>

    ${r.closed ? html`
      <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
        Обращение закрыто — дописать в него нельзя.
      </div>`
      : html`
      <div class="field-label">Ответ жителю</div>
      <textarea id="councilReqReply" placeholder="Что вы решили или что нужно уточнить"></textarea>
      <div class="field-error" id="councilReqReplyErr"></div>
      <button class="btn-primary" data-action="council-send-comment" data-id="${esc(r.id)}">
        Отправить жителю
      </button>`}`;
}

function fileSize(bytes) {
  const size = Number(bytes ?? 0);
  if (size < 1024) return 'меньше 1 КБ';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

/** Решения по заявкам и переходы внутри раздела. */
export async function handleCouncilAction(action, target, ctx) {
  if (action === 'council-house') {
    await ctx.go('council-house');
    return true;
  }

  if (action === 'council-requests') {
    await ctx.go('council-requests');
    return true;
  }

  if (action === 'council-request') {
    await ctx.go('council-request', { id: target.dataset.id });
    return true;
  }

  if (action === 'council-send-comment') {
    const field = document.querySelector('#councilReqReply');
    const err = document.querySelector('#councilReqReplyErr');
    const text = field?.value.trim() ?? '';

    if (text.length < 2) {
      field?.classList.add('error');
      if (err) {
        err.textContent = 'Напишите ответ — пустое сообщение не поможет';
        err.classList.add('show');
      }
      field?.focus();
      return true;
    }
    field?.classList.remove('error');
    err?.classList.remove('show');

    await withLoading(target, async () => {
      try {
        await api.chairmanCommentRequest(target.dataset.id, text, ctx.state.council.house.houseKey);
        toast('Ответ отправлен');
        await ctx.show('council-request', { id: target.dataset.id });
      } catch (error) {
        toast(error.message);
      }
    });
    return true;
  }

  if (action === 'claim-owner' || action === 'claim-member') {
    const role = action === 'claim-owner' ? 'owner' : 'member';
    await withLoading(target, async () => {
      try {
        await api.decideClaim(target.dataset.id, role);
        toast(role === 'owner' ? 'Подтверждён собственником' : 'Подтверждён жильцом');
        /**
         * Свой профиль тоже обновляем.
         *
         * Председатель часто подтверждает СЕБЯ — вторую свою квартиру,
         * и без этого у него в «Моей недвижимости» продолжала висеть
         * плашка «ожидает», хотя в базе уже стояло `active`. Очередь
         * при этом обновлялась, и выглядело как поломка подтверждения.
         */
        await ctx.refreshMe?.();
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
        await ctx.refreshMe?.();
        await ctx.refresh();
      } catch (error) {
        toast(error.message);
      }
    });
    return true;
  }

  return false;
}
