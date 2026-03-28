package com.xiangyang.elderly.ble

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.xiangyang.elderly.data.BleConnectionState
import com.xiangyang.elderly.data.PhoneData
import com.xiangyang.elderly.data.GasData
import com.xiangyang.elderly.data.RadarData
import com.xiangyang.elderly.data.SensorData
import com.xiangyang.elderly.data.SmokeData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.util.UUID

/**
 * BLE Manager for ElderCare ESP32 device communication.
 * Implements Nordic UART Service (NUS) protocol over BLE.
 */
@SuppressLint("MissingPermission")
class BleManager(private val context: Context) {

    companion object {
        private const val TAG = "BleManager"

        // Nordic UART Service UUIDs
        val NUS_SERVICE_UUID: UUID = UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
        val NUS_TX_CHAR_UUID: UUID = UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E") // ESP32 → Phone (Notify)
        val NUS_RX_CHAR_UUID: UUID = UUID.fromString("6E400002-B5A3-F393-E0A9-E50E24DCCA9E") // Phone → ESP32 (Write)

        // Device name prefix
        const val DEVICE_NAME_PREFIX = "ElderCare_ESP32"

        // Scan timeout
        private const val SCAN_TIMEOUT_MS = 15000L
    }

    // BLE components
    private val bluetoothAdapter: BluetoothAdapter? = BluetoothManagerCompat.getBluetoothAdapter(context)
    private val scanner: BluetoothLeScanner? = bluetoothAdapter?.bluetoothLeScanner
    private var bluetoothGatt: BluetoothGatt? = null

    // Connection state
    private val _connectionState = MutableStateFlow(BleConnectionState.DISCONNECTED)
    val connectionState: StateFlow<BleConnectionState> = _connectionState.asStateFlow()

    // Connected device info
    private val _connectedDeviceName = MutableStateFlow<String?>(null)
    val connectedDeviceName: StateFlow<String?> = _connectedDeviceName.asStateFlow()

    private val _connectedDeviceAddress = MutableStateFlow<String?>(null)
    val connectedDeviceAddress: StateFlow<String?> = _connectedDeviceAddress.asStateFlow()

    // Sensor data
    private val _sensorData = MutableStateFlow<SensorData?>(null)
    val sensorData: StateFlow<SensorData?> = _sensorData.asStateFlow()

    // Scanned devices
    private val _scannedDevices = MutableStateFlow<List<BluetoothDevice>>(emptyList())
    val scannedDevices: StateFlow<List<BluetoothDevice>> = _scannedDevices.asStateFlow()

    // Scanning state
    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning.asStateFlow()

    // Error messages
    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    // Auto-reconnect
    private var autoReconnectEnabled = true
    private var lastConnectedAddress: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    // Scan timeout runnable
    private val scanTimeoutRunnable = Runnable {
        stopScan()
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SCANNING
    // ─────────────────────────────────────────────────────────────────────────────

    fun startScan() {
        val adapter = bluetoothAdapter
        val scanner = scanner

        if (adapter == null || !adapter.isEnabled) {
            _errorMessage.value = "蓝牙未开启或不可用"
            return
        }

        if (_isScanning.value) {
            stopScan()
        }

        _scannedDevices.value = emptyList()
        _isScanning.value = true
        _errorMessage.value = null

        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            scanner?.startScan(null, scanSettings, scanCallback)
            // Schedule scan timeout
            mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
        } catch (e: Exception) {
            _isScanning.value = false
            _errorMessage.value = "扫描启动失败: ${e.message}"
            Log.e(TAG, "Start scan failed", e)
        }
    }

    fun stopScan() {
        if (!_isScanning.value) return
        _isScanning.value = false
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try {
            scanner?.stopScan(scanCallback)
        } catch (e: Exception) {
            Log.e(TAG, "Stop scan failed", e)
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val name = device.name ?: return

            // Filter for ElderCare devices
            if (!name.startsWith(DEVICE_NAME_PREFIX)) return

            val currentList = _scannedDevices.value.toMutableList()
            // Avoid duplicates
            if (currentList.none { it.address == device.address }) {
                currentList.add(device)
                _scannedDevices.value = currentList
            }
        }

        override fun onScanFailed(errorCode: Int) {
            _isScanning.value = false
            _errorMessage.value = "扫描失败 (错误码: $errorCode)"
            Log.e(TAG, "Scan failed: $errorCode")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CONNECTION
    // ─────────────────────────────────────────────────────────────────────────────

    fun connect(deviceAddress: String) {
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            _errorMessage.value = "蓝牙未开启"
            return
        }

        // Disconnect existing connection first
        disconnect()

        _connectionState.value = BleConnectionState.CONNECTING
        _errorMessage.value = null
        lastConnectedAddress = deviceAddress

        val device = adapter.getRemoteDevice(deviceAddress)
        connectToDevice(device)
    }

    fun connectByName(deviceName: String) {
        val device = _scannedDevices.value.find { it.name == deviceName }
        if (device != null) {
            connect(device.address)
        } else {
            _errorMessage.value = "未找到设备: $deviceName"
        }
    }

    private fun connectToDevice(device: BluetoothDevice) {
        try {
            bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
            } else {
                device.connectGatt(context, false, gattCallback)
            }
        } catch (e: Exception) {
            _connectionState.value = BleConnectionState.ERROR
            _errorMessage.value = "连接失败: ${e.message}"
            Log.e(TAG, "connectToDevice failed", e)
        }
    }

    fun disconnect() {
        autoReconnectEnabled = false
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try {
            bluetoothGatt?.disconnect()
            bluetoothGatt?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Disconnect error", e)
        }
        bluetoothGatt = null
        _connectionState.value = BleConnectionState.DISCONNECTED
        _connectedDeviceName.value = null
        _connectedDeviceAddress.value = null
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // GATT CALLBACK
    // ─────────────────────────────────────────────────────────────────────────────

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    _connectionState.value = BleConnectionState.CONNECTED
                    _connectedDeviceName.value = gatt.device.name
                    _connectedDeviceAddress.value = gatt.device.address
                    autoReconnectEnabled = true
                    // Discover services
                    try {
                        gatt.discoverServices()
                    } catch (e: Exception) {
                        Log.e(TAG, "discoverServices failed", e)
                    }
                    Log.i(TAG, "Connected to ${gatt.device.name}")
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    _connectionState.value = BleConnectionState.DISCONNECTED
                    _connectedDeviceName.value = null
                    _connectedDeviceAddress.value = null
                    bluetoothGatt?.close()
                    bluetoothGatt = null
                    Log.i(TAG, "Disconnected")

                    // Auto-reconnect
                    if (autoReconnectEnabled && lastConnectedAddress != null) {
                        mainHandler.postDelayed({
                            lastConnectedAddress?.let { addr ->
                                _connectionState.value = BleConnectionState.CONNECTING
                                try {
                                    bluetoothAdapter?.getRemoteDevice(addr)?.let { device ->
                                        connectToDevice(device)
                                    }
                                } catch (e: Exception) {
                                    _connectionState.value = BleConnectionState.ERROR
                                    _errorMessage.value = "重连失败: ${e.message}"
                                }
                            }
                        }, 3000)
                    }
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                // Enable notifications on TX characteristic
                val service = gatt.getService(NUS_SERVICE_UUID)
                val txChar = service?.getCharacteristic(NUS_TX_CHAR_UUID)
                if (txChar != null) {
                    gatt.setCharacteristicNotification(txChar, true)
                    val descriptor = txChar.getDescriptor(
                        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
                    )
                    descriptor?.let {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            gatt.writeDescriptor(it, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                        } else {
                            @Suppress("DEPRECATION")
                            it.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            @Suppress("DEPRECATION")
                            gatt.writeDescriptor(it)
                        }
                    }
                }
                // Request initial data
                sendCommand("get_status")
                Log.i(TAG, "Services discovered, notifications enabled")
            } else {
                Log.w(TAG, "Service discovery failed: $status")
            }
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            if (characteristic.uuid == NUS_TX_CHAR_UUID) {
                val jsonString = String(value, Charsets.UTF_8)
                Log.d(TAG, "BLE received: $jsonString")
                parseSensorData(jsonString)
            }
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (characteristic.uuid == NUS_TX_CHAR_UUID) {
                @Suppress("DEPRECATION")
                val value = characteristic.value
                if (value != null) {
                    val jsonString = String(value, Charsets.UTF_8)
                    Log.d(TAG, "BLE received: $jsonString")
                    parseSensorData(jsonString)
                }
            }
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "BLE write success: ${characteristic.uuid}")
            } else {
                Log.w(TAG, "BLE write failed: $status")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SENDING COMMANDS
    // ─────────────────────────────────────────────────────────────────────────────

    fun sendCommand(cmd: String) {
        val gatt = bluetoothGatt
        if (gatt == null || _connectionState.value != BleConnectionState.CONNECTED) {
            _errorMessage.value = "设备未连接"
            return
        }

        val service = gatt.getService(NUS_SERVICE_UUID)
        val rxChar = service?.getCharacteristic(NUS_RX_CHAR_UUID)
        if (rxChar == null) {
            _errorMessage.value = "找不到写 characteristic"
            return
        }

        val json = JSONObject().put("cmd", cmd).toString()
        val bytes = json.toByteArray(Charsets.UTF_8)

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                gatt.writeCharacteristic(rxChar, bytes, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
            } else {
                @Suppress("DEPRECATION")
                rxChar.value = bytes
                @Suppress("DEPRECATION")
                rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(rxChar)
            }
            Log.d(TAG, "Sent command: $json")
        } catch (e: Exception) {
            _errorMessage.value = "发送命令失败: ${e.message}"
            Log.e(TAG, "Send command failed", e)
        }
    }

    fun refreshData() {
        sendCommand("get_status")
    }

    fun requestWifiStatus() {
        sendCommand("wifi_status")
    }

    fun rebootDevice() {
        sendCommand("reboot")
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // JSON PARSING
    // ─────────────────────────────────────────────────────────────────────────────

    private fun parseSensorData(jsonString: String) {
        try {
            val json = JSONObject(jsonString)

            val deviceId = json.optString("device_id", "unknown")
            val uptimeS = json.optLong("uptime_s", 0L)
            val wifiRssi = json.optInt("wifi_rssi", -100)
            val fwVersion = json.optString("fw_version", "unknown")
            val rawJson = jsonString

            val sensors = json.optJSONObject("sensors")

            // LD2420 Radar
            var radar: RadarData? = null
            sensors?.optJSONObject("radar")?.let { r ->
                radar = RadarData(
                    targetDetected = r.optBoolean("target_detected", false),
                    fallDetected = r.optBoolean("fall_detected", false),
                    targetCount = r.optInt("target_count", 0),
                    xMm = r.optInt("x_mm", 0),
                    yMm = r.optInt("y_mm", 0),
                    speedMmPerS = r.optInt("speed_mm_s", 0)
                )
            }

            // Smoke sensor
            var smoke: SmokeData? = null
            sensors?.optJSONObject("smoke")?.let { s ->
                smoke = SmokeData(
                    concentration = s.optDouble("concentration", 0.0).toFloat(),
                    alarm = s.optBoolean("alarm", false),
                    unit = s.optString("unit", "ppm"),
                    rawAdc = s.optInt("raw_adc", 0)
                )
            }

            // Gas sensor
            var gas: GasData? = null
            sensors?.optJSONObject("gas")?.let { g ->
                gas = GasData(
                    concentration = g.optDouble("concentration", 0.0).toFloat(),
                    alarm = g.optBoolean("alarm", false),
                    unit = g.optString("unit", "ppm"),
                    rawAdc = g.optInt("raw_adc", 0)
                )
            }

            // Phone module
            var phone: PhoneData? = null
            sensors?.optJSONObject("phone")?.let { b ->
                phone = PhoneData(
                    heartRate = b.optInt("heart_rate", 0),
                    bloodOxygen = b.optInt("blood_oxygen", 0),
                    buttonPressed = b.optBoolean("button_pressed", false),
                    battery = b.optInt("battery", 0),
                    connected = b.optBoolean("connected", false)
                )
            }

            val sensorData = SensorData(
                deviceId = deviceId,
                uptimeS = uptimeS,
                wifiRssi = wifiRssi,
                fwVersion = fwVersion,
                radar = radar,
                smoke = smoke,
                gas = gas,
                phone = phone,
                rawJson = rawJson
            )

            _sensorData.value = sensorData

        } catch (e: Exception) {
            Log.e(TAG, "parseSensorData failed: ${e.message}", e)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────────

    fun isBluetoothEnabled(): Boolean = bluetoothAdapter?.isEnabled == true

    fun clearError() {
        _errorMessage.value = null
    }

    fun getDeviceDisplayName(): String {
        return _connectedDeviceName.value ?: _scannedDevices.value.firstOrNull()?.name ?: "未知设备"
    }
}

/**
 * Compatibility helper for BluetoothManager across API levels.
 */
object BluetoothManagerCompat {
    @SuppressLint("DEPRECATION")
    fun getBluetoothAdapter(context: Context): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager
        return manager?.adapter ?: BluetoothAdapter.getDefaultAdapter()
    }
}
