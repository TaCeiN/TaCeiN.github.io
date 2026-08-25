import { api, ApiError } from '../api.js';
import { platform } from '../platform.js';
import { scanNative, scanWithCamera, scanFromFile, cameraAvailable } from '../qr.js';
import { esc, html, toast, withLoading, errorState } from '../ui.js';

/**
 * Вход по QR квитанции.
 *
 * Это первый экран и главный вау-момент демо: человек наводит камеру
 * на бумажную квитанцию и оказывается внутри — с именем, адресом
 * и лицевым счётом. Ни SMS, ни формы, ни пароля.
 */

let cameraSession = null;

export function renderLogin(state) {
  const { config, error, name, addingAddress } = state;

  /**
   * В бою вход по квитанции работает только внутри MAX.
   *
   * Говорим это СРАЗУ, а не после сканирования. Иначе человек, открывший
   * сайт в браузере, наводит камеру на квитанцию, ждёт — и только тогда
   * получает отказ. Обещание, которое не выполняется, хуже отсутствующей
   * кнопки: выглядит как поломка приложения.
   */
  if (config && config.webLogin === false && !platform.inMax) {
    return html`
      <div class="page active" id="page-login">
        <div class="onb-hero">
          <div class="onb-logo">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M4 10.5L12 4L20 10.5V19.5C20 20 19.6 20.5 19 20.5H5C4.4 20.5 4 20 4 19.5V10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          </div>
          <div class="dt-title" style="margin-top:0">Заречье. Дом</div>
          <div class="success-p" style="margin:10px auto 0">
            Приложение открывается внутри мессенджера MAX. Там личность
            подтверждает сама платформа — поэтому вход по квитанции
            безопасен и не требует пароля.
          </div>
        </div>

        <div class="dt-card">
          <div class="meter-name">Как войти</div>
          <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
            Найдите в MAX бота
            ${config.botUsername ? html`<b>@${esc(config.botUsername)}</b>` : 'вашего дома'}
            и откройте мини-приложение. Дальше — отсканировать QR-код
            с квитанции ЖКУ, всё остальное приложение сделает само.
          </div>
          ${config.botUsername ? html`
            <a class="btn-primary" style="display:block;text-align:center;text-decoration:none"
               href="https://max.ru/${esc(config.botUsername)}?startapp"
               target="_blank" rel="noopener">Открыть в MAX</a>` : ''}
        </div>

        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Кабинет управляющей компании — по адресу <b>/dispatcher/</b>,
          он работает в браузере.
        </div>
      </div>`;
  }

  const canScanNative = platform.inMax;
  const canScanCamera = cameraAvailable();


  return html`
    <div class="page active" id="page-login">
      <div class="onb-hero">
        <div class="onb-logo">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M4 10.5L12 4L20 10.5V19.5C20 20 19.6 20.5 19 20.5H5C4.4 20.5 4 20 4 19.5V10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </div>
        ${addingAddress
          // Заголовок уже стоит в шапке экрана — повторять его незачем
          ? ''
          : html`<div class="dt-title" style="margin-top:0">
              ${name ? `${esc(name)},<br>подтвердите адрес` : 'Заречье. Дом'}
            </div>`}
        <div class="success-p" style="margin:10px auto 0">
          ${addingAddress
            /**
             * Два разных сценария за одной кнопкой, и оба надо назвать.
             *
             * Чаще это ВТОРАЯ КВИТАНЦИЯ той же квартиры: свет, газ, вывоз
             * мусора приходят отдельными платёжками. Пока экран назывался
             * «квитанция нового адреса», человек с платёжкой за газ просто
             * не понимал, что ему сюда.
             */
            ? `Свет, газ, вывоз мусора приходят отдельными квитанциями —
               отсканируйте каждую, и все они добавятся к вашей квартире.
               Квитанция другого адреса заведёт второй адрес.`
            : `Отсканируйте QR-код с квитанции ЖКУ — приложение само определит
               адрес, лицевой счёт и вашу управляющую компанию`}
        </div>
      </div>

      <div class="scanner" id="scannerBox" hidden>
        <video id="scannerVideo" playsinline muted></video>
        <canvas id="scannerCanvas" hidden></canvas>
        <div class="scanner-frame"></div>
        <button class="scanner-close" data-action="scan-stop" aria-label="Закрыть">
          <svg width="16" height="16" viewBox="0 0 12 12" fill="none"><path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div id="loginError">${error ? errorState(error) : ''}</div>

      ${canScanNative || canScanCamera ? `
        <button class="btn-primary" data-action="scan" id="scanBtn">
          Отсканировать квитанцию
        </button>` : ''}

      <label class="btn-primary secondary" style="cursor:pointer">
        Загрузить фото квитанции
        <input type="file" accept="image/*" id="qrFile" hidden>
      </label>

      <div class="field-label" style="margin-top:26px">Где искать QR-код</div>
      <div class="dt-p" style="margin-top:0">
        Платёжный QR печатается на квитанции рядом с суммой к оплате.
        В нём уже есть всё нужное — вводить ничего не придётся.
      </div>

      ${config?.devTools ? `
        <div class="field-label" ${addingAddress ? 'style="margin-top:26px"' : ''}>
          Вставить строку QR вручную
        </div>
        <div class="dt-p" style="font-size:13px;color:var(--tx-2);margin-bottom:10px">
          Для проверки без камеры: строка напечатана в QR квитанции.
        </div>
        <textarea id="qrManual" placeholder="ST00011|Name=...|persAcc=..."></textarea>
        <button class="btn-primary secondary" data-action="manual">
          ${addingAddress ? 'Добавить по строке' : 'Войти по строке'}
        </button>
      ` : ''}
    </div>`;
}

/** Обработчики экрана входа. Возвращает функцию очистки. */
export function bindLogin(root, { onSuccess, rerender }) {
  const showError = (error) => {
    const box = root.querySelector('#loginError');
    if (box) box.innerHTML = errorState(error);
  };

  /**
   * Отправка отсканированной строки.
   *
   * Квитанцию запоминаем: на занятом лицевом счёте сервер сначала спросит
   * имя, и повторно наводить камеру человеку не придётся.
   */
  let lastQr = null;
  /** Улица, выбранная в подсказке: код нужен серверу, а не текст поля */
  let chosenStreet = null;
  /** Заявка, которую сейчас дозаполняет человек */
  let pendingBinding = null;

  async function submit(qr, button, extra) {
    if (!qr) return;
    lastQr = qr;

    await withLoading(button, async () => {
      try {
        const result = await api.loginQr(qr, extra);

        /**
         * Квитанция заводит ЗАЯВКУ, а не открывает квартиру.
         *
         * Ответ один и тот же — занят лицевой счёт или свободен. Раньше
         * ответы различались, и по ним перебирались номера счетов
         * и фамилии собственников.
         */
        if (result?.status === 'pending') {
          platform.haptic('medium');
          if (result.claimComplete) showPending(result);
          else showClaimForm(result);
          return;
        }

        platform.haptic('medium');
        onSuccess(result);
      } catch (error) {
        /**
         * В квитанции нет адреса — спрашиваем его один раз.
         *
         * По ГОСТ Р 56042-2014 адрес плательщика необязателен, и расчётные
         * центры его не печатают. Восстановить дом по одному лицевому счёту
         * невозможно: эта связка есть только в биллинге получателя платежа.
         */
        if (error instanceof ApiError && error.code === 'needs_address') {
          showAddressForm(error.body);
          return;
        }
        if (error instanceof ApiError && error.code === 'region_not_loaded') {
          showRegionMissing(error.body);
          return;
        }
        /** В бою вход по квитанции живёт только внутри MAX */
        if (error instanceof ApiError && error.code === 'web_login_disabled') {
          showWebLoginClosed(error.message);
          return;
        }
        showError(error);
      }
    });
  }

  /**
   * Шаг «кто вы».
   *
   * Квитанция выписана на собственника, поэтому по ней собственник
   * и домочадец выглядят одинаково — угадать нельзя, надо спросить.
   * Раньше приложение молча решало само, и ломалось в обе стороны: то
   * владелец не мог добавить свежую квитанцию, то посторонний попадал
   * в чужой кабинет.
   */
  /**
   * Шаг «расскажите о себе».
   *
   * ЗАЧЕМ ОН ЕСТЬ. Доступ открывает председатель совета дома — человек,
   * который знает соседей в лицо. Но узнать он должен КОГО-ТО: в MAX
   * у половины аккаунтов нет фамилии, а у части вместо имени ник.
   * Поэтому ФИО и квартиру житель называет сам, а свободной строкой
   * может объяснить, кто он.
   *
   * Прежней формы «кто вы: жилец или собственник» здесь больше нет.
   * Она спрашивала человека о том, что проверить всё равно нельзя,
   * а ответ «это мой счёт» превращал экран в оракул для перебора ФИО:
   * угаданная фамилия сразу открывала чужой кабинет.
   */
  function showClaimForm(result) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    pendingBinding = result.bindingId;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Заявка принята</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${result.hasChairman
            ? `Доступ подтверждает председатель совета дома. Расскажите о себе,
               чтобы он понял, кто вы.`
            : `Доступ подтверждает управляющая компания. Расскажите о себе,
               чтобы вас можно было найти в её данных.`}
        </div>

        <div class="field-label">Фамилия и имя</div>
        <input type="text" id="claimName" placeholder="Иванова Мария" autocomplete="name">

        <div class="field-label">Номер квартиры</div>
        <input type="text" id="claimFlat" placeholder="27" autocomplete="off">

        <div class="field-label">Что передать председателю</div>
        <textarea id="claimNote" placeholder="Например: живу с 2019 года, квартира на пятом этаже"></textarea>

        <div class="field-error" id="claimErr"></div>

        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Эти данные видит только тот, кто подтверждает доступ.
        </div>

        <button class="btn-primary" data-action="send-claim">Отправить заявку</button>
      </div>`;
    root.querySelector('#claimName')?.focus();
  }

  /** Вход по квитанции вне мессенджера в бою закрыт — объясняем честно. */
  function showWebLoginClosed(message) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Вход работает внутри MAX</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(message)}
        </div>
      </div>`;
  }

  /**
   * Выбор адреса из справочника.
   *
   * Улицу человек выбирает из подсказки, а номер дома и квартиры вводит
   * руками. Свободный ввод улицы был бы проще в коде и хуже в жизни: соседи
   * по одному дому написали бы адрес пятью способами, houseKey разошёлся,
   * и лента дома развалилась бы на пять «домов» по одному жильцу.
   */
  function showAddressForm(info) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">В квитанции нет адреса</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(info?.payeeName ?? 'Получатель')} печатает квитанции без адреса —
          там только лицевой счёт ${esc(info?.persAcc ?? '')}. Укажите адрес
          один раз, дальше он подставится сам.
        </div>

        <div class="field-label">Улица${info?.regionName ? `, ${esc(info.regionName)}` : ''}</div>
        <input type="text" id="addrStreet" placeholder="Начните вводить название"
               autocomplete="off" data-region="${esc(info?.regionCode ?? '')}">
        <div class="addr-hits" id="addrHits" hidden></div>
        <div class="field-error" id="addrErr"></div>

        <div class="addr-row">
          <div>
            <div class="field-label">Дом</div>
            <input type="text" id="addrHouse" placeholder="85 или 15А, 4Б/1" autocomplete="off">
          </div>
          <div>
            <div class="field-label">Корпус</div>
            <input type="text" id="addrBlock" placeholder="—" autocomplete="off">
          </div>
          <div>
            <div class="field-label">Строение</div>
            <input type="text" id="addrBuilding" placeholder="—" autocomplete="off">
          </div>
        </div>

        <div class="field-label">Квартира</div>
        <input type="text" id="addrFlat" placeholder="27" autocomplete="off">
        <div class="dt-p" style="font-size:13px;color:var(--tx-2);margin-top:8px">
          Частный дом — оставьте квартиру пустой. Букву и дробь пишите
          прямо в номере дома: «15А», «4Б/1».
        </div>

        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Управляющая компания увидит, что адрес указали вы, и подтвердит его.
        </div>

        <button class="btn-primary" data-action="submit-address">Продолжить</button>
      </div>`;

    bindStreetSearch();
    root.querySelector('#addrStreet')?.focus();
  }

  /** Регион не подключён: врать про «скоро» не надо, объясняем как есть. */
  function showRegionMissing(info) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    const available = info?.available ?? [];

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Регион пока не подключён</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(info?.message ?? '')}
        </div>
        ${available.length ? html`
          <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
            Сейчас загружены: ${esc(available.map((r) => r.name).join(', '))}.
          </div>` : ''}
        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Попросите управляющую компанию подключиться к сервису — тогда адрес
          подставится автоматически, без ручного ввода.
        </div>
      </div>`;
  }

  /** Подсказка улиц. Запрос уходит с задержкой: иначе он летит на каждую букву. */
  function bindStreetSearch() {
    const field = root.querySelector('#addrStreet');
    const hits = root.querySelector('#addrHits');
    if (!field || !hits) return;

    let timer = null;

    field.addEventListener('input', () => {
      chosenStreet = null;
      clearTimeout(timer);
      const value = field.value.trim();

      if (value.length < 2) {
        hits.hidden = true;
        return;
      }

      timer = setTimeout(async () => {
        try {
          const data = await api.streets(field.dataset.region, value);
          hits.innerHTML = data.streets.length
            ? data.streets.map((s) => html`
                <button class="addr-hit" data-action="pick-street"
                        data-code="${esc(s.code)}" data-label="${esc(s.label)}">
                  ${esc(s.label)}
                </button>`).join('')
            : '<div class="addr-empty">Ничего не найдено</div>';
          hits.hidden = false;
        } catch (error) {
          hits.innerHTML = `<div class="addr-empty">${esc(error.message)}</div>`;
          hits.hidden = false;
        }
      }, 250);
    });
  }

  /** Экран ожидания. Проверка статуса — по кнопке, а не опросом сервера. */
  function showPending(result) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Заявка отправлена</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${result.hasChairman
            ? `Председатель совета дома увидит её и подтвердит доступ.`
            : `Управляющая компания увидит её и подтвердит доступ.`}
          Повторно сканировать квитанцию не нужно — приложение вас запомнило.
        </div>
        <button class="btn-primary" data-action="check-approval">Я получил доступ</button>
      </div>`;
  }

  async function startScan(button) {
    // Внутри MAX нативный сканер лучше во всём: права, качество, скорость
    if (platform.inMax) {
      const value = await scanNative();
      if (value) await submit(value, button);
      else toast('Сканирование отменено');
      return;
    }

    const box = root.querySelector('#scannerBox');
    box.hidden = false;
    stopCamera();

    cameraSession = await scanWithCamera({
      video: root.querySelector('#scannerVideo'),
      canvas: root.querySelector('#scannerCanvas'),
      onResult: async (value) => {
        box.hidden = true;
        await submit(value, button);
      },
      onError: (error) => {
        box.hidden = true;
        showError(error);
      },
    });
  }

  function stopCamera() {
    cameraSession?.stop();
    cameraSession = null;
  }

  const onClick = async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'scan') await startScan(target);
    if (action === 'scan-stop') {
      stopCamera();
      root.querySelector('#scannerBox').hidden = true;
    }
    if (action === 'manual') {
      const value = root.querySelector('#qrManual')?.value.trim();
      if (!value) return toast('Вставьте строку QR');
      await submit(value, target);
    }
    if (action === 'pick-street') {
      chosenStreet = { code: target.dataset.code, label: target.dataset.label };
      const field = root.querySelector('#addrStreet');
      if (field) field.value = target.dataset.label;
      const hits = root.querySelector('#addrHits');
      if (hits) hits.hidden = true;
      root.querySelector('#addrHouse')?.focus();
      return;
    }

    if (action === 'submit-address') {
      const errorBox = root.querySelector('#addrErr');
      const house = root.querySelector('#addrHouse')?.value.trim() ?? '';
      const flat = root.querySelector('#addrFlat')?.value.trim() ?? '';

      const complain = (text) => {
        if (errorBox) {
          errorBox.textContent = text;
          errorBox.classList.add('show');
        }
      };

      if (!chosenStreet) return complain('Выберите улицу из подсказки');
      if (!house) return complain('Укажите номер дома');
      // Квартиру не требуем: у частного дома её нет
      errorBox?.classList.remove('show');

      await submit(lastQr, target, {
        address: {
          streetCode: chosenStreet.code,
          house,
          block: root.querySelector('#addrBlock')?.value.trim() || undefined,
          building: root.querySelector('#addrBuilding')?.value.trim() || undefined,
          flat: flat || undefined,
        },
      });
      return;
    }

    if (action === 'send-claim') {
      const name = root.querySelector('#claimName')?.value.trim() ?? '';
      const flat = root.querySelector('#claimFlat')?.value.trim() ?? '';
      const note = root.querySelector('#claimNote')?.value.trim() ?? '';
      const error = root.querySelector('#claimErr');

      const complain = (text) => {
        if (error) {
          error.textContent = text;
          error.classList.add('show');
        }
      };

      if (name.length < 3) return complain('Укажите фамилию и имя');
      if (!flat) return complain('Укажите номер квартиры');
      error?.classList.remove('show');

      await withLoading(target, async () => {
        try {
          await api.sendClaim(pendingBinding, { name, flat, note });
          showPending({ hasChairman: true });
        } catch (e) {
          complain(e.message);
        }
      });
      return;
    }

    if (action === 'check-approval') {
      /**
       * Собственник мог подтвердить доступ в любой момент. Сессия у нас
       * уже есть, поэтому проверка — обычная загрузка своих данных:
       * появилась активная привязка, значит пустили.
       */
      await withLoading(target, async () => {
        try {
          const me = await api.me();
          if (me.properties.length > 0) {
            platform.haptic('medium');
            onSuccess({ status: 'ok' });
          } else {
            toast('Собственник пока не подтвердил доступ');
          }
        } catch {
          toast('Не удалось проверить. Попробуйте ещё раз');
        }
      });
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const value = await scanFromFile(file);
      await submit(value, null);
    } catch (error) {
      showError(error);
    } finally {
      event.target.value = '';
    }
  };

  root.addEventListener('click', onClick);
  root.querySelector('#qrFile')?.addEventListener('change', onFile);

  return () => {
    stopCamera();
    root.removeEventListener('click', onClick);
  };
}

/**
 * Вход внутри MAX: если человек уже привязал счёт, квитанция не нужна.
 * Возвращает 'ok' | 'needs_receipt' | null.
 */
export async function tryMaxLogin() {
  if (!platform.inMax) return null;
  try {
    const result = await api.loginMax();
    return result?.status ?? null;
  } catch {
    return null;
  }
}
