import uvicorn
from app import asgi   # ⬅️ IMPORTA LA INSTANCIA, NO EL MÓDULO

if __name__ == "__main__":
    uvicorn.run(
        asgi,          # ⬅️ AQUÍ VA LA INSTANCIA
        host="0.0.0.0",
        port=8080,
        reload=True
    )
