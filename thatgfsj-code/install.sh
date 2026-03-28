#!/bin/bash
# Thatgfsj Code Installer for macOS/Linux
# Usage: curl -sL https://raw.githubusercontent.com/Thatgfsj/thatgfsj-code/main/install.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}  Thatgfsj Code 安装向导${NC}"
echo -e "${CYAN}  =======================${NC}"
echo ""

# ============== Step 1: Check Node.js ==============
echo -e "${YELLOW}[*] 检查 Node.js...${NC}"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -ge 18 ]; then
        echo -e "${GREEN}[✓] Node.js $NODE_VERSION 已安装${NC}"
    else
        echo -e "${RED}[✗] Node.js 版本过低，需要 v18+${NC}"
        echo "    请访问 https://nodejs.org 升级"
        exit 1
    fi
else
    echo -e "${YELLOW}[*] 未检测到 Node.js，开始安装...${NC}"
    
    # Try Homebrew (macOS)
    if command -v brew &> /dev/null; then
        echo -e "${YELLOW}[*] 使用 Homebrew 安装...${NC}"
        brew install node
    # Try apt (Ubuntu/Debian)
    elif command -v apt-get &> /dev/null; then
        echo -e "${YELLOW}[*] 使用 apt 安装...${NC}"
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    # Try yum (CentOS/RHEL)
    elif command -v yum &> /dev/null; then
        echo -e "${YELLOW}[*] 使用 yum 安装...${NC}"
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo yum install -y nodejs
    else
        echo -e "${RED}[✗] 未找到包管理器${NC}"
        echo "    请手动安装: https://nodejs.org"
        exit 1
    fi
fi

# ============== Step 2: Clone/Update ==============
echo -e "${YELLOW}[*] 准备安装 Thatgfsj Code...${NC}"

INSTALL_DIR="$HOME/thatgfsj-code"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[*] 检测到已有安装，正在更新...${NC}"
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || {
        echo -e "${YELLOW}[*] 更新失败，重新克隆...${NC}"
        rm -rf "$INSTALL_DIR"
    }
fi

if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[*] 克隆仓库...${NC}"
    git clone https://github.com/Thatgfsj/thatgfsj-code.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [ ! -f "package.json" ]; then
    echo -e "${RED}[✗] 安装目录无效${NC}"
    exit 1
fi

echo -e "${GREEN}[✓] 代码准备完成: $INSTALL_DIR${NC}"

# ============== Step 3: Install Dependencies ==============
echo -e "${YELLOW}[*] 安装依赖...${NC}"

npm install
npm run build

echo -e "${GREEN}[✓] 依赖安装完成${NC}"

# ============== Step 4: Link Command ==============
echo -e "${YELLOW}[*] 设置命令...${NC}"

npm link

echo -e "${GREEN}[✓] 命令 'gfcode' 已可用${NC}"

# ============== Done ==============
echo ""
echo -e "${CYAN}  ======================================${NC}"
echo -e "${GREEN}  安装完成!${NC}"
echo -e "${CYAN}  ======================================${NC}"
echo ""
echo -e "  ${WHITE}使用方法:${NC}"
echo -e "    gfcode init          - 重新配置"
echo -e "    gfcode               - 启动交互模式"
echo -e "    gfcode '你的问题'    - 直接提问"
echo -e "    gfcode explain '代码' - 解释代码"
echo -e "    gfcode debug '代码'   - 调试代码"
echo ""
echo -e "  文档: ${CYAN}https://github.com/Thatgfsj/thatgfsj-code${NC}"
echo ""
