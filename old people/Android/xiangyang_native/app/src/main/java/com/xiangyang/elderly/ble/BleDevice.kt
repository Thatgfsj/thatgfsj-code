package com.xiangyang.elderly.ble

/**
 * BLE device discovered during scanning.
 */
data class BleDevice(
    val deviceId: String,
    val name: String,
    val rssi: Int = 0
)
