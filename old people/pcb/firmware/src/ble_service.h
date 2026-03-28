#ifndef BLE_SERVICE_H
#define BLE_SERVICE_H

#include <Arduino.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

class BLECallbacks {
public:
    virtual void onBLECommandReceived(const String& cmd, const String& value) = 0;
};

class ElderCareBLEService {
public:
    ElderCareBLEService();
    void begin(const String& deviceId);
    void updateSensorData(const String& jsonData);
    void setCommandCallback(BLECallbacks* cb);
    void checkConnection();

    BLEAdvertising* pAdvertising = nullptr;
    bool isConnected = false;
    String currentDeviceId;
    BLECallbacks* commandCallback = nullptr;

private:
    BLEServer* pServer = nullptr;
    BLEService* pService = nullptr;
    BLECharacteristic* pTxCharacteristic = nullptr;
    BLECharacteristic* pRxCharacteristic = nullptr;

    static const char* SERVICE_UUID;
    static const char* CHAR_TX_UUID;
    static const char* CHAR_RX_UUID;

    friend class MyServerCallbacks;
    friend class MyCharacteristicCallbacks;
};

#endif
