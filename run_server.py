import os
import sys
import http.server
import socketserver

def start_server(port=8080):
    print(f"🌐 [Web Server] 正在启动预览服务器...")

    # 确保在项目根目录运行
    original_cwd = os.getcwd()
    try:
        # 进入静态资源目录
        if os.path.exists("public"):
            os.chdir("public")
        else:
            print("❌ 错误: 找不到 public 目录，请在项目根目录运行。")
            return

        Handler = http.server.SimpleHTTPRequestHandler
        socketserver.TCPServer.allow_reuse_address = True

        with socketserver.TCPServer(("", port), Handler) as httpd:
            print(f"\n✨ 服务已就绪!")
            print(f"👉 访问地址: http://localhost:{port}")
            print(f"💡 提示: 修改 index.html 后，直接刷新页面即可。")
            print("-" * 40)
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 已停止服务器。")
    except Exception as e:
        print(f"\n❌ 服务器崩溃: {e}")
    finally:
        os.chdir(original_cwd)

if __name__ == "__main__":
    start_server()
