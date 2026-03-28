#include "config.h"
#include "ble_service.h"
#include "BLEDevice.h"

// BLE uses static storage for callbacks (ESP32 restriction)
static ElderCareBLEService* sBLEInstance = nullptr;

// ==================== BLE Server Callbacks ====================
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        sBLEInstance->isConnected = true;
        Serial.println("[BLE] Client connected");
    }

    void onDisconnect(BLEServer* pServer) {
        sBLEInstance->isConnected = false;
        Serial.println("[BLE] Client disconnected");
        // Restart advertising after disconnect
        if (sBLEInstance->pAdvertising) {
            sBLEInstance->pAdvertising->start();
        }
    }
};

// ==================== BLE Characteristic Callbacks ====================
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pCharacteristic) {
        String rxData = pCharacteristic->getValue().c_str();
        Serial.printf("[BLE] Received: %s\n", rxData.c_str());
        
        // Parse simple JSON-like commands:
        // {"cmd": "get_status"}
        // {"cmd": "calibrate", "param": "smoke"}
        if (rxData.length() > 0 && sBLEInstance->commandCallback) {
            // Extract command name (simplified parser)
            int cmdStart = rxData.indexOf("\"cmd\":");
            if (cmdStart >= 0) {
                cmdStart = rxData.indexOf("\"", cmdStart + 6) + 1;
                int cmdEnd = rxData.indexOf("\"", cmdStart);
                String cmd = rxData.substring(cmdStart, cmdEnd);
                
                // Extract optional param
                String value = "";
                int valStart = rxData.indexOf("\"param\":");
                if (valStart >= 0) {
                    valStart = rxData.indexOf("\"", valStart + 8) + 1;
                    int valEnd = rxData.indexOf("\"", valStart);
                    value = rxData.substring(valStart, valEnd);
                }
                
                sBLEInstance->commandCallback->onBLECommandReceived(cmd, value);
            }
        }
    }
};

// ==================== ElderCareBLEService ====================
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
    
    // Create BLE Device with custom name
    BLEDevice::init(BLE_DEVICE_NAME);
    
    // Create BLE Server
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    
    // Create BLE Service
    pService = pServer->createService(SERVICE_UUID);
    
    // Create TX Characteristic (ESP32 → Phone) - with Notify
    pTxCharacteristic = pService->createCharacteristic(
        CHAR_TX_UUID,
        BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_INDICATE
    );
    pTxCharacteristic->addDescriptor(new BLE2902());
    
    // Create RX Characteristic (Phone → ESP32) - with Write
    pRxCharacteristic = pService->createCharacteristic(
        CHAR_RX_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
    );
    pRxCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
    
    // Start service
    pService->start();
    
    // Configure advertising
    pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);
    pAdvertising->setMinPreferred(0x12);
    
    // Start advertising
    BLEDevice::startAdvertising();
    
    sBLEInstance = this;
    Serial.printf("[BLE] Started, device: %s\n", deviceId.c_str());
}

void ElderCareBLEService::updateSensorData(const String& jsonData) {
    if (!isConnected) return;
    
    if (pTxCharacteristic) {
        pTxCharacteristic->setValue(jsonData.c_str());
        pTxCharacteristic->notify();
    }
}

void ElderCareBLEService::setCommandCallback(BLECallbacks* cb) {
    commandCallback = cb;
}

void ElderCareBLEService::checkConnection() {
    // Could re-advertise if disconnected for too long
    if (!isConnected && pAdvertising) {
        // Already handled by onDisconnect callback which starts advertising
    }
}
