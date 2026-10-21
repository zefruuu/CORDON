#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>
#include "protocol.h"

// PIN_CC1101_CS   = 7
// PIN_CC1101_SCK  = 4
// PIN_CC1101_MOSI = 6
// PIN_CC1101_MISO = 5
// PIN_CC1101_GDO0 = 3
// PIN_STATUS_LED  = 8

CC1101 radio = new Module(PIN_CC1101_CS, PIN_CC1101_GDO0, RADIOLIB_NC, PIN_CC1101_GDO2);


volatile bool packetReceivedFlag = false;
bool radioReady = false;
uint32_t lastStatusMs = 0;


struct DedupEntry {
    uint8_t  node_id;
    uint16_t seq_number;
    bool     used;
};

DedupEntry dedupBuffer[DEDUP_BUFFER_SIZE] = {};
uint8_t dedupIndex = 0;



#if defined(ESP8266) || defined(ESP32)
ICACHE_RAM_ATTR
#endif
void onRadioPacketInterrupt(void) {
    packetReceivedFlag = true;
}


bool isDuplicatePacket(uint8_t nodeId, uint16_t seqNum) {
    for (int i = 0; i < DEDUP_BUFFER_SIZE; i++) {
        if (dedupBuffer[i].used && dedupBuffer[i].node_id == nodeId && dedupBuffer[i].seq_number == seqNum) {
            return true;
        }
    }
    dedupBuffer[dedupIndex].node_id = nodeId;
    dedupBuffer[dedupIndex].seq_number = seqNum;
    dedupBuffer[dedupIndex].used = true;
    dedupIndex = (dedupIndex + 1) % DEDUP_BUFFER_SIZE;

    return false;
}



bool initRadioCC1101() {

    SPI.begin(PIN_CC1101_SCK, PIN_CC1101_MISO, PIN_CC1101_MOSI, PIN_CC1101_CS);

    int state = radio.begin(CORDON_RF_FREQ_MHZ, 4.8, 25.0, 135.0, 10, 32);
    if (state != RADIOLIB_ERR_NONE) {
        Serial.printf("[GATEWAY] CC1101 init error: %d\n", state);
        return false;
    }


    radio.setSyncWord(0xC0, 0x26);
    radio.setCrcFiltering(false);
    radio.fixedPacketLengthMode(sizeof(CordonPacket));
    radio.setPacketReceivedAction(onRadioPacketInterrupt);



    state = radio.startReceive();
    if (state != RADIOLIB_ERR_NONE) {
        Serial.printf("[GATEWAY] CC1101 startReceive error: %d\n", state);
        return false;
    }

    return true;
}



void setup() {
    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, HIGH);
    Serial.begin(115200);
    delay(2000);

    radioReady = initRadioCC1101();
    if (radioReady) {
        Serial.println("[GATEWAY] CC1101 Init OK! Listening on 433.92 MHz");
        digitalWrite(PIN_STATUS_LED, LOW); 
    } else {
        Serial.println("[GATEWAY] Failed to initialize CC1101");
    }
}



void loop() {
    if (!radioReady) {
        digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
        delay(1000);
        radioReady = initRadioCC1101();
        return;
    }

    if (millis() - lastStatusMs >= 5000) {
        lastStatusMs = millis();
        Serial.println("[GATEWAY] CC1101 ONLINE | Listening 433.92 MHz...");
    }

    if (packetReceivedFlag) {
        packetReceivedFlag = false;
    } else {
        return;
    }


    uint8_t rawBytes[sizeof(CordonPacket)] = {0};
    int state = radio.readData(rawBytes, sizeof(CordonPacket));

    if (state == RADIOLIB_ERR_NONE) {
        CordonPacket pkt;
        memcpy(&pkt, rawBytes, sizeof(CordonPacket));

        if (pkt.crc != calcCordonCRC(pkt)) {
            Serial.println("[GATEWAY] Invalid CRC");
            radio.startReceive();
            return;
        }

        if (isDuplicatePacket(pkt.node_id, pkt.seq_number)) {
            Serial.println("[GATEWAY] Duplicate packet");
            radio.startReceive();
            return;
        }

        float bat = pkt.battery_mv / 1000.0f;
        bool radar = (pkt.sensor_flags & FLAG_RADAR) != 0;
        bool metal = (pkt.sensor_flags & FLAG_METAL) != 0;

        Serial.printf("{\"id\":%d,\"type\":%d,\"flags\":%d,\"radar\":%d,\"metal\":%d,\"bat\":%.2f,\"hops\":%d}\n",
                      pkt.node_id, pkt.msg_type, pkt.sensor_flags, radar, metal, bat, pkt.hops);
    }
    else {
        Serial.printf("[GATEWAY] Error reading packet: %d\n", state);
    }
    radio.startReceive();
}
