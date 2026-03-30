import type { Socket } from 'socket.io-client';

export type ChatLang = 'UR' | 'EN' | 'AR';

type TranslateResponse = {
  success?: boolean;
  text?: string;
};

export function translateChatText(
  socket: Socket | null,
  text: string,
  toLang: ChatLang,
  fromLang: string = 'auto',
): Promise<{ success: boolean; text: string }> {
  return new Promise((resolve) => {
    const safeText = text?.trim() ?? '';
    if (!socket || !safeText) {
      resolve({ success: false, text: safeText });
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, text: safeText });
    }, 10000);

    socket.emit(
      'translateChatMessage',
      { text: safeText, toLang, fromLang },
      (res: TranslateResponse | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          success: !!res?.success,
          text: (res?.text ?? safeText).trim(),
        });
      },
    );
  });
}
