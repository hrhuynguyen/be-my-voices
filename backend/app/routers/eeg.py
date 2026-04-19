from fastapi import APIRouter, HTTPException, status

from app.schemas.eeg import ConnectMuseRequest, EEGDebugResponse, EEGTelemetryResponse
from app.services import eeg_service
from app.services.eeg_service import EEGServiceError

router = APIRouter(prefix="/api/eeg", tags=["eeg"])


@router.post("/connect", response_model=EEGTelemetryResponse)
async def connect_muse(
    request: ConnectMuseRequest | None = None,
) -> EEGTelemetryResponse:
    try:
        return eeg_service.connect_device(request)
    except EEGServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/disconnect", response_model=EEGTelemetryResponse)
async def disconnect_muse() -> EEGTelemetryResponse:
    return eeg_service.disconnect_device()


@router.post("/check", response_model=EEGTelemetryResponse)
async def check_muse_connection() -> EEGTelemetryResponse:
    return eeg_service.check_connection()


@router.get("/telemetry", response_model=EEGTelemetryResponse)
async def get_muse_telemetry() -> EEGTelemetryResponse:
    return eeg_service.get_telemetry()


@router.get("/debug", response_model=EEGDebugResponse)
async def get_muse_debug_snapshot() -> EEGDebugResponse:
    return eeg_service.get_debug_snapshot()
