import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';

export type BluetoothDevice = {
  id: string;
  name: string | null;
  rssi: number | null;
};

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const apiLevel = (Platform as any).Version ?? 0;
    if (apiLevel >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      const granted =
        result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
      return granted;
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function useBluetooth() {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [bleAvailable, setBleAvailable] = useState(false);
  const devicesMapRef = useRef<Map<string, BluetoothDevice>>(new Map());
  const managerRef = useRef<typeof import('react-native-ble-plx').BleManager | null>(null);

  useEffect(() => {
    if (!isNative) return;
    try {
      const { BleManager } = require('react-native-ble-plx');
      const manager = new BleManager();
      managerRef.current = manager;
      setBleAvailable(true);
      return () => {
        try {
          manager.destroy();
        } catch (_) {}
        managerRef.current = null;
        setBleAvailable(false);
      };
    } catch (e) {
      // Native BLE module not available (e.g. Expo Go, web, or simulator)
      managerRef.current = null;
      setBleAvailable(false);
    }
  }, []);

  const startScan = useCallback(async () => {
    if (!isNative) {
      setScanError(
        'Bluetooth scanning is only available on the native app. On web, pair your device in system Bluetooth settings and audio will follow that output.',
      );
      return;
    }
    if (!bleAvailable) {
      setScanError('Bluetooth scanning is only available on iOS and Android (development build).');
      return;
    }
    const manager = managerRef.current;
    if (!manager) return;

    const hasPermission = await requestBlePermissions();
    if (!hasPermission) {
      setScanError('Bluetooth and Location permissions are required to scan for devices.');
      return;
    }

    setScanError(null);
    devicesMapRef.current.clear();
    setDevices([]);
    setIsScanning(true);

    manager.startDeviceScan(
      null,
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          setScanError(error.message);
          manager.stopDeviceScan();
          setIsScanning(false);
          return;
        }
        if (device) {
          const id = device.id;
          const name = device.name ?? null;
          const rssi = device.rssi ?? null;
          const next = new Map(devicesMapRef.current);
          next.set(id, { id, name, rssi });
          devicesMapRef.current = next;
          setDevices(Array.from(next.values()));
        }
      }
    );
  }, [bleAvailable]);

  const stopScan = useCallback(() => {
    if (!isNative) return;
    const manager = managerRef.current;
    if (manager) {
      manager.stopDeviceScan();
    }
    setIsScanning(false);
  }, []);

  return {
    btState: 'on' as const,
    devices,
    isScanning,
    scanError,
    startScan,
    stopScan,
    isBleSupported: isNative && bleAvailable,
  };
}