import { useState } from 'react';

export function useBluetooth() {
  // Discovery is Socket.IO-based (internet), not native Bluetooth.
  // No BLE library required.
  const [btState] = useState<'on'>('on');
  return { btState };
}
