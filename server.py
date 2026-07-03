import uvicorn
from data_model.coordinate import distance, Coord
from data_model.track import Track
import logging
import re
import os
import json
from datetime import datetime, timezone, date
from fastapi import FastAPI, Request, HTTPException, Body
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

from uvicorn.logging import DefaultFormatter

handler = logging.StreamHandler()
handler.setFormatter(DefaultFormatter("%(levelprefix)s %(message)s"))

logger = logging.getLogger("swissalpine")
logger.addHandler(handler)
logger.setLevel(logging.INFO)
#logger.propagate = False

logger.info("Start")


limiter = Limiter(key_func=get_remote_address)
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

track = Track("data/t808746431_k78-78.2-km.gpx")

latest_position: dict | None = None
position_event = asyncio.Event()

def read_actual_positions(start_time: datetime, track: Track) -> list:
    result = []
    min_ts = start_time.timestamp()
    global last_pt_idx
    for file_name in os.listdir("data/actual"):
        if file_name.endswith(".log"):
            date_str =file_name[:-4].split('_')[-1]
            file_date = date.fromisoformat(date_str)
            if file_date>=start_time.date():           
                path = os.path.join("data/actual", file_name)
                with open(path, 'r') as f:
                    for line in f.readlines():
                        tokens = line.split(';')
                        gps_ts = int(tokens[4])
                        if min_ts<=gps_ts:
                            lat = float(tokens[1])
                            lon = float(tokens[2])
                            ele = float(tokens[3])
                            bat = float(tokens[5])

                            pt_idx, dist = track.find(Coord(lat, lon), last_pt_idx - 10, last_pt_idx + 500)
                            entry = {'lat': lat, 'lon': lon,'ele':ele, 'bat': bat, 'ts':gps_ts}
                            if (dist < 100):
                                entry['pt_idx'] = pt_idx
                                last_pt_idx = pt_idx

                            result.append(entry)
    return result

#start_time = datetime.fromisoformat("2026-07-18T05:00:00+02:00")
start_time = datetime.fromisoformat("2026-07-01T10:35:42+02:00")
last_pt_idx = 0

actual_points = read_actual_positions(start_time, track)
 
@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="main.html.jinja",
        context={"track": track, 'actual_points_json': json.dumps(actual_points), 'start_time': start_time.isoformat() }
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

@app.post("/start_override")
def start_override(start_time_str: str = Body(..., embed=True)):
    global start_time
    global actual_points
    start_time = datetime.fromisoformat(start_time_str)
    logger.info(f"start-override {start_time}")
    actual_points = read_actual_positions(start_time, track)
    return {"ok": True, "start_time": start_time}

 
@app.get("/log")
@limiter.limit("60/minute")
def log(request: Request, c: str):
    safe_c = re.sub(r'[^\x20-\x7E]', '', c)[:100]
    logger.info(f"content={safe_c}")

    # 47.4924304,8.7412871,496.4000244140625,1782247587,70.0,mz
    ts_now = int(datetime.now().timestamp())
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
        logger.info(f"lat={lat}, lon={lon}, ele={ele}, ts={ts} ({time}), bat={tokens[4]}, mz={tokens[5]} at server time {datetime.fromtimestamp(ts_now)}")
    except ValueError:
        raise HTTPException(status_code=422, detail="lat and lon must be numbers")
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        raise HTTPException(status_code=422, detail="lat/lon out of range")
                              
    pt_idx, dist = track.find(Coord(lat, lon), last_pt_idx - 100, last_pt_idx + 2000)
    global latest_position
    latest_position = {'lat': lat, 'lon': lon,'ele':ele, 'bat': bat, 'ts':ts}
    if (dist<100):
        latest_position['pt_idx'] = pt_idx
    position_event.set()
    actual_points.append(latest_position)
   
    file = f"data/actual/log_{tokens[5]}_{time.date().isoformat()}.log"
    with open(file, "a") as f:
        f.write(f"{ts_now};{';'.join(tokens[:-1])}\n")
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
   uvicorn.run(app, host="127.0.0.1", port=8016)
