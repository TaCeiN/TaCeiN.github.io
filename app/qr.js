import { platform } from './platform.js';

/**
 * Получение строки платёжного QR с квитанции.
 *
 * Четыре пути, и порядок не случайный:
 *   1. Нативный сканер MAX — лучший UX, без запроса прав у браузера
 *   2. Камера через getUserMedia + jsQR — браузерный режим, требует HTTPS
 *   3. Фото из галереи — когда камеры нет или прав не дали
 *   4. Ручная вставка строки — для тестов без бумажной квитанции
 *
 * КЛЮЧЕВОЕ ПРО КОДИРОВКУ. Квитанции печатаются в Windows-1251 (заголовок
 * ST00011). jsQR отдаёт СЫРЫЕ БАЙТЫ в binaryData — их и надо декодировать
 * по признаку из заголовка. Если взять готовую строку jsQR (она собрана как
 * UTF-8), вся кириллица превратится в мусор: ФИО и адрес станут нечитаемыми.
 */

const ENCODINGS = { 1: 'windows-1251', 2: 'utf-8', 3: 'koi8-r' };

/** Декодирует байты QR по признаку кодировки из служебного блока. */
export function decodeQrBytes(bytes) {
  if (!bytes || bytes.length < 8) return null;

  const header = String.fromCharCode(...bytes.slice(0, 8));
  if (!header.startsWith('ST')) return null;

  const label = ENCODINGS[header[6]];
  if (!label) return null;

  try {
    return new TextDecoder(label).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
}

/** Из результата jsQR достаём правильно декодированную строку. */
function fromJsQr(result) {
  if (!result) return null;
  const decoded = decodeQrBytes(result.binaryData);
  // Если это не платёжный QR — отдаём как есть, ошибку покажет сервер
  return decoded ?? result.data ?? null;
}

let jsQrPromise = null;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsQrPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Резолвим от модуля, а не от страницы: приложение может лежать
    // в подпапке GitHub Pages, и абсолютный путь тогда уедет в корень домена
    script.src = new URL('../vendor/jsQR.js', import.meta.url).href;
    script.onload = () => resolve(window.jsQR);
    script.onerror = () => reject(new Error('Не удалось загрузить декодер QR'));
    document.head.appendChild(script);
  });
  return jsQrPromise;
}

/** Есть ли вообще смысл показывать кнопку камеры. */
export function cameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

/**
 * Сканирование камерой в браузере.
 * Возвращает объект с методом stop() — поток нужно закрывать вручную,
 * иначе камера останется включённой после ухода с экрана.
 */
export async function scanWithCamera({ video, canvas, onResult, onError }) {
  if (!cameraAvailable()) {
    onError?.(new Error(
      window.isSecureContext
        ? 'Камера недоступна на этом устройстве'
        : 'Камера работает только по HTTPS. Загрузите фото квитанции.',
    ));
    return { stop() {} };
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (error) {
    onError?.(new Error(
      error?.name === 'NotAllowedError'
        ? 'Доступ к камере не разрешён. Можно загрузить фото квитанции.'
        : 'Не удалось включить камеру. Можно загрузить фото квитанции.',
    ));
    return { stop() {} };
  }

  const jsQR = await loadJsQr().catch((e) => { onError?.(e); return null; });
  if (!jsQR) {
    stream.getTracks().forEach((t) => t.stop());
    return { stop() {} };
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => {});

  let stopped = false;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  function tick() {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: 'dontInvert',
      });

      if (found) {
        const text = fromJsQr(found);
        if (text) {
          stop();
          onResult(text);
          return;
        }
      }
    }
    requestAnimationFrame(tick);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  requestAnimationFrame(tick);
  return { stop };
}

/** Распознавание из файла: фото квитанции из галереи. */
export async function scanFromFile(file) {
  const jsQR = await loadJsQr();
  const bitmap = await createImageBitmap(file);

  // Большие фото уменьшаем: на 12-мегапиксельном снимке декодер задумывается
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);

  const image = context.getImageData(0, 0, width, height);
  const found = jsQR(image.data, image.width, image.height);
  bitmap.close?.();

  if (!found) throw new Error('QR-код на фото не найден. Попробуйте снять ближе и ровнее.');
  return fromJsQr(found);
}

/** Нативный сканер MAX, если приложение открыто внутри мессенджера. */
export async function scanNative() {
  return platform.scanNative(true);
}
