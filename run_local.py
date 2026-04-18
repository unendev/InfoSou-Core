import run_crawler
import run_server
import sys

def main():
    print("=== InfoSou 本地控制台 ===")
    print("1. 运行数据抓取 (Crawler)")
    print("2. 启动预览服务器 (Server)")
    print("3. 先抓取再启动 (Full Cycle)")
    print("4. 退出")
    
    choice = input("\n请输入选项 (1-4): ").strip()
    
    if choice == '1':
        run_crawler.run_crawler()
    elif choice == '2':
        run_server.start_server()
    elif choice == '3':
        if run_crawler.run_crawler():
            run_server.start_server()
    else:
        print("已退出。")

if __name__ == "__main__":
    main()
