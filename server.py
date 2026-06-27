import uvicorn
from data_model.coordinate import distance, Coord
from data_model.track import Track
import logging
import re
from datetime import datetime, timezone
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi.templating import Jinja2Templates
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.sse import EventSourceResponse, ServerSentEvent
from collections.abc import AsyncIterable, Iterable
import asyncio
from pydantic import BaseModel




limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

track = Track("data/t808746431_k78-78.2-km.gpx")

latest_position: dict | None = None
position_event = asyncio.Event()

@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="test.html.jinja",
        context={"track": track}
    )

@app.get("/track.points.csv")
def track_points_csv():
    return StreamingResponse(
        track.points_as_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": "inline; filename=track.points.csv"}
    )

@app.get("/track.segments.csv")
def track_segments_csv():
    return StreamingResponse(
        track.segments_as_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": "inline; filename=track.segments.csv"}
    )

@app.get("/log")
@limiter.limit("30/minute")
def log(request: Request, c: str):
    safe_c = re.sub(r'[^\x20-\x7E]', '', c)[:100]
    logging.info(f"content={safe_c}")

    # 47.4924304,8.7412871,496.4000244140625,1782247587,70.0,mz

    tokens = c.split(",")
    if len(tokens) != 6:
        raise HTTPException(status_code=422, detail="Expected 'lat,lon,alt,ts,bat,mz'")
    try:
        lat = float(tokens[0])
        lon = float(tokens[1])
        ele = float(tokens[2])
        ts = int(tokens[3])
        bat = int(tokens[4])
        time = datetime.fromtimestamp(ts)
        print(f"lat={lat}, lon={lon}, ele={ele}, ts={ts} ({time}), bat={tokens[4]}, mz={tokens[5]}")
    except ValueError:
        raise HTTPException(status_code=422, detail="lat and lon must be numbers")
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        raise HTTPException(status_code=422, detail="lat/lon out of range")
    
    pt_idx, dist = track.find(Coord(lat, lon))
    global latest_position
    latest_position = {'lat': lat, 'lon': lon,'ele':ele, 'bat': bat, 'ts':ts}
    if (dist<100):
        latest_position['pt_idx'] = pt_idx
    position_event.set()
   
    file = f"data/actual/log_{tokens[5]}_{time.date().isoformat()}.log"
    with open(file, "a") as f:
        f.write(f"{int(datetime.now().timestamp())};{';'.join(tokens[:-1])}\n")
    return {"ok": True}



@app.get("/position", response_class=EventSourceResponse)
async def position() -> AsyncIterable[ServerSentEvent]:
    i = 0
    while True:
        await position_event.wait()   # blocks until GPS ping arrives
        position_event.clear()        # reset for next ping
        i += 1
        yield ServerSentEvent(data=latest_position, event='posUpdate', id=str(i))

if __name__ == "__main__":
   uvicorn.run(app, host="192.168.178.90", port=8016)
