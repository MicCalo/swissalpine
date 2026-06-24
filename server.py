from fastapi import FastAPI
import uvicorn
from data_model.coordinate import distance, Coord
from data_model.track import Track
import logging
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates



app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

track = Track("../t808746431_k78-78.2-km.gpx")

def find(c: Coord):
    (best_dist, best_id) = (float("inf"), None)
    for segment in track:       
        dist = distance(c, segment.coord)
        if (dist < best_dist):
            best_dist = dist
            best_id = segment.id
    return best_id

 
@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="test.html.jinja",
        context={"track": track}
    )

@app.get("/log")
def log(c: str):
    logging.info(f"content={c}")
    tokens = c.split(",")
    lat = float(tokens[0])
    lon = float(tokens[1])
    c = Coord(lat, lon)
    best_id = find(c)
    with open("log.txt", "a") as f:
        f.write(f"{lat},{lon},{best_id}\n")
    return {"ok": True, "best_id": best_id}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
