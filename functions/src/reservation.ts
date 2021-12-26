import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { FORTY_FIVE_DAYS } from "./constants";

export const addRoomReservation = functions.https.onCall(
  async (data: {
    hotelId: string;
    roomId: string;
    start: string;
    end: string;
  }) => {
    const start = new Date(data.start).getTime();
    const end = new Date(data.end).getTime();

    if (start >= end) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "end date must be greater than start date"
      );
    }

    if (end - start > FORTY_FIVE_DAYS) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "room reservation for more than 45 days is not possible"
      );
    }

    let reservationId: string;
    try {
      reservationId = await addRoomReservationInFirestore({
        hotelId: data.hotelId,
        roomId: data.roomId,
        start: admin.firestore.Timestamp.fromMillis(start),
        end: admin.firestore.Timestamp.fromMillis(end),
      });
    } catch (error) {
      if (error instanceof RoomAlreadyReservedError) {
        throw new functions.https.HttpsError("already-exists", error.message);
      } else {
        functions.logger.error(error);
        throw new functions.https.HttpsError("internal", "internal error");
      }
    }

    return {
      hotelId: data.hotelId,
      roomId: data.roomId,
      reservationId,
    };
  }
);

async function addRoomReservationInFirestore({
  hotelId,
  roomId,
  start,
  end,
}: {
  hotelId: string;
  roomId: string;
  start: admin.firestore.Timestamp;
  end: admin.firestore.Timestamp;
}): Promise<string> {
  const roomRef = admin
    .firestore()
    .collection("hotels")
    .doc(hotelId)
    .collection("rooms")
    .doc(roomId);
  const reservationId: string = await admin
    .firestore()
    .runTransaction(async (tx) => {
      const [reservationSnap, reservationSnap2] = await Promise.all([
        tx.get(
          roomRef
            .collection("reservation")
            .where("start", ">=", start)
            .where("start", "<=", end)
            .limit(1)
        ),
        tx.get(
          roomRef
            .collection("reservation")
            .where("end", "<=", end)
            .where("end", ">=", start)
            .limit(1)
        ),
      ]);

      if (!reservationSnap.empty || !reservationSnap2.empty) {
        throw new RoomAlreadyReservedError("room already reserved");
      }

      const reservationRef = roomRef.collection("reservation").doc();
      tx.create(reservationRef, {
        start: start,
        end: end,
      });
      return reservationRef.id;
    });
  return reservationId;
}

class RoomAlreadyReservedError extends Error {}
