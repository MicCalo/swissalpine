from fastapi import FastAPI
import uvicorn

app = FastAPI()


@app.get("/log")
def log(c: str):
    print(f"content={c}")
    tokens = c.split(",")
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=80)
