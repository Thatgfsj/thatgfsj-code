#include "config.h"
#include "ble_service.h"
#include "BLEDevice.h"

static ElderCareBLEService* sBLEInstance = nullptr;

// ==================== Server Callbacks ====================
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        sBLEInstance->isConnected = true;
        Serial.println("[BLE] Client connected");
    }
    void onDisconnect(BLEServer* pServer) {
        sBLEInstance->isConnected = false;
        Serial.println("[BLE] Client disconnected");
        if (sBLEInstance->pAdvertising) {
            sBLEInstance->pAdvertising->start();
        }
    }
};

// ==================== Characteristic Callbacks ====================
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        String rxData = pCharacteristic->getValue().c_str();
        Serial.printf("[BLE] RX: %s\n", rxData.c_str());

        if (rxData.length() > 0 && sBLEInstance->commandCallback) {
            int cmdStart = rxData.indexOf("\"cmd\":");
            if (cmdStart >= 0) {
                cmdStart = rxData.indexOf("\"", cmdStart + 6) + 1;
                int cmdEnd = rxData.indexOf("\"", cmdStart);
                String cmd = rxData.substring(cmdStart, cmdEnd);

                String value = "";
                int valStart = rxData.indexOf("\"param\":");
                if (valStart >= 0) {
                    valStart = rxData.indexOf("\"", valStart + 8) + 1;
                    int valEnd = rxData.indexOf("\"", valStart);
                    value = rxData.substring(valStart, valEnd);
                }
                // Also check "ssid" and "pass" for wifi command
                if (cmd == "wifi") {
                    int ssidStart = rxData.indexOf("\"ssid\":");
                    int passStart = rxData.indexOf("\"pass\":");
                    if (ssidStart >= 0 && passStart >= 0) {
                        ssidStart = rxData.indexOf("\"", ssidStart + 7) + 1;
                        int ssidEnd = rxData.indexOf("\"", ssidStart);
                        passStart = rxData.indexOf("\"", passStart + 7) + 1;
                        int passEnd = rxData.indexOf("\"", passStart);
                        String ssid = rxData.substring(ssidStart, ssidEnd);
                        String pass = rxData.substring(passStart, passEnd);
                        value = ssid + "," + pass;
                    }
                }

                sBLEInstance->commandCallback->onBLECommandReceived(cmd, value);
            }
        }
    }
};

// ==================== Service ====================
const char* ElderCareBLEService::SERVICE_UUID = BLE_SERVICE_UUID;
const char* ElderCareBLEService::CHAR_TX_UUID = BLE_CHAR_TX_UUID;
const char* ElderCareBLEService::CHAR_RX_UUID = BLE_CHAR_RX_UUID;

ElderCareBLEService::ElderCareBLEService() {
    pServer = nullptr;
    pService = nullptr;
    pTxCharacteristic = nullptr;
    pRxCharacteristic = nullptr;
    pAdvertising = nullptr;
    isConnected = false;
    commandCallback = nullptr;
}

void ElderCareBLEService::begin(const String& deviceId) {
    currentDeviceId = deviceId;
    BLEDevice::init(BLE_DEVICE_NAME);
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    pService = pServer->createService(SERVICE_UUID);

    pTxCharacteristic = pService->createCharacteristic(
        CHAR_TX_UUID,
        BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_INDICATE
    );
    pTxCharacteristic->addDescriptor(new BLE2902());

    pRxCharacteristic = pService->createCharacteristic(
        CHAR_RX_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
    );
    pRxCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

    pService->start();

    pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    BLEDevice::startAdvertising();

    sBLEInstance = this;
    Serial.printf("[BLE] Started: %s\n", deviceId.c_str());
}

void ElderCareBLEService::updateSensorData(const String& jsonData) {
    if (!isConnected || !pTxCharacteristic) return;
    pTxCharacteristic->setValue(jsonData.c_str());
    pTxCharacteristic->notify();
}

void ElderCareBLEService::setCommandCallback(BLECallbacks* cb) {
    commandCallback = cb;
}

void ElderCareBLEService::checkConnection() {
    // handled by callbacks
}
