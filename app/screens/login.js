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
  const canScanNative = platform.inMax;
  const canScanCamera = cameraAvailable();

  return html`
    <div class="page active" id="page-login">
      <div class="onb-hero">
        <div class="onb-logo">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M4 10.5L12 4L20 10.5V19.5C20 20 19.6 20.5 19 20.5H5C4.4 20.5 4 20 4 19.5V10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </div>
        <div class="dt-title" style="margin-top:0">
          ${addingAddress
            ? 'Квитанция нового адреса'
            : name ? `${esc(name)},<br>подтвердите адрес` : 'Заречье. Дом'}
        </div>
        <div class="success-p" style="margin:10px auto 0">
          ${addingAddress
            ? `Отсканируйте QR-код квитанции второго адреса — он добавится
               к вашему аккаунту. Если лицевой счёт уже занят, доступ
               подтвердит его собственник.`
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

      ${config?.demoMode && !addingAddress ? `
        <div class="field-label" style="margin-top:26px">Демо-режим</div>
        <div class="list">
          <button class="row tappable" data-action="demo" data-acc="4460153">
            <span class="sq new"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M2 15V6L8 2L14 6V15H2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></span>
            <div class="content"><div class="t">Войти как Анна Смирнова</div><div class="d">Демо-квартира 15 с историей за полгода</div></div>
          </button>
        </div>
        <div class="field-label">Вставить строку QR вручную</div>
        <textarea id="qrManual" placeholder="ST00011|Name=...|persAcc=..."></textarea>
        <button class="btn-primary secondary" data-action="manual">Войти по строке</button>
      ` : ''}
    </div>`;
}

/** Обработчики экрана входа. Возвращает функцию очистки. */
export function bindLogin(root, { onSuccess, rerender }) {
  const showError = (error) => {
    const box = root.querySelector('#loginError');
    if (box) box.innerHTML = errorState(error);
  };

  async function submit(qr, button) {
    if (!qr) return;
    await withLoading(button, async () => {
      try {
        const result = await api.loginQr(qr);
        platform.haptic('medium');
        onSuccess(result);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'needs_owner_approval') {
          showError(error);
          toast('Нужно подтверждение собственника');
          return;
        }
        showError(error);
      }
    });
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
    if (action === 'demo') {
      await withLoading(target, async () => {
        try {
          await api.loginDemo(target.dataset.acc);
          onSuccess({ status: 'ok' });
        } catch (error) { showError(error); }
      });
    }
    if (action === 'manual') {
      const value = root.querySelector('#qrManual')?.value.trim();
      if (!value) return toast('Вставьте строку QR');
      await submit(value, target);
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
