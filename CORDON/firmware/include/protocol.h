#pragma once
#include <stdint.h>
#include <stddef.h>

#define PIN_CC1101_CS      7
#define PIN_CC1101_SCK     4
#define PIN_CC1101_MOSI    6
#define PIN_CC1101_MISO    5
#define PIN_CC1101_GDO0    3
#define PIN_CC1101_GDO2    -1

#define PIN_PIR_WAKEUP     1
#define PIN_MOSFET_GATE    2
#define PIN_RADAR_OUT      0
#define PIN_I2C_SDA        20
#define PIN_I2C_SCL        21

#define PIN_STATUS_LED     8

#define CORDON_RF_FREQ_MHZ 433.92f
#define CORDON_MAX_HOPS    3
#define DEDUP_BUFFER_SIZE  16

enum MessageType : uint8_t {
    MSG_HEARTBEAT = 0x01,
    MSG_ALARM     = 0x02,
    MSG_TAMPER    = 0x03
};

enum SensorFlags : uint8_t {
    FLAG_SEISMIC = 1 << 0,
    FLAG_RADAR   = 1 << 1,
    FLAG_METAL   = 1 << 2,
    FLAG_TAMPER  = 1 << 3
};

struct __attribute__((packed)) CordonPacket {
    uint8_t  node_id;
    uint8_t  msg_type;
    uint8_t  sensor_flags;
    uint16_t battery_mv;
    uint16_t seq_number;
    uint8_t  hops;
    uint16_t crc;
};

inline uint16_t calcCordonCRC(const CordonPacket& pkt) {
    const uint8_t* data = reinterpret_cast<const uint8_t*>(&pkt);
    const size_t len = sizeof(CordonPacket) - sizeof(uint16_t);
    uint16_t crc = 0xFFFF;

    for (size_t i = 0; i < len; i++) {
        crc ^= static_cast<uint16_t>(data[i]) << 8;
        for (uint8_t bit = 0; bit < 8; bit++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    return crc;
}
