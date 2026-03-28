#ifndef BLE_SERVICE_H
#define BLE_SERVICE_H

#include <Arduino.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Forward declaration
class BLEService;

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

private:
    BLEServer* pServer;
    BLEService* pService;
    BLECharacteristic* pTxCharacteristic;  // ESP32 sends to phone
    BLECharacteristic* pRxCharacteristic;  // ESP32 receives from phone
    BLEAdvertising* pAdvertising;
    bool isConnected;
    String currentDeviceId;
    BLECallbacks* commandCallback;

    static const char* SERVICE_UUID;
    static const char* CHAR_TX_UUID;  // Phone → ESP32 (we'll call it TX from phone perspective)
    static const char* CHAR_RX_UUID;  // ESP32 → Phone
};

#endif // BLE_SERVICE_H
