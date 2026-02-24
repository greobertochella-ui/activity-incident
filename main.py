import uvicorn
import app  # importa app.py

def main():
    uvicorn.run(
        app.asgi,
        host="0.0.0.0",
        port=8000,
        reload=True
    )

if __name__ == "__main__":
    main()