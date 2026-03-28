# Thatgfsj Code Installer for Windows
# Usage: 
#   powershell -c "irm https://raw.githubusercontent.com/Thatgfsj/thatgfsj-code/main/install.ps1 | iex"
#   powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Thatgfsj/thatgfsj-code/main/install.ps1)))"

param(
    [switch]$NoOpen,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Colors
function Write-Step { param($msg) Write-Host "[*] $msg" -ForegroundColor Yellow }
function Write-Success { param($msg) Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Error { param($msg) Write-Host "[✗] $msg" -ForegroundColor Red }
function Write-Info { param($msg) Write-Host "    $msg" -ForegroundColor Gray }

Write-Host ""
Write-Host "  Thatgfsj Code 安装向导" -ForegroundColor Cyan
Write-Host "  =======================" -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    Write-Host "[DRY RUN] 仅显示将要执行的操作" -ForegroundColor Yellow
    Write-Host ""
}

# ============== Step 1: Check PowerShell ==============
Write-Step "检查 PowerShell 版本..."

if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Error "需要 PowerShell 5.0 或更高版本"
    Write-Host "请升级您的 PowerShell: https://aka.ms/powershell" -ForegroundColor Gray
    exit 1
}
Write-Success "PowerShell $($PSVersionTable.PSVersion) 检测正常"

# ============== Step 2: Check/Fetch Node.js ==============
Write-Step "检查 Node.js..."

function Test-NodeInstalled {
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            $version = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
            return @{ installed = $true; version = $nodeVersion; major = $version }
        }
    } catch {}
    return @{ installed = $false; version = $null; major = 0 }
}

$nodeStatus = Test-NodeInstalled
if ($nodeStatus.installed -and $nodeStatus.major -ge 18) {
    Write-Success "Node.js $($nodeStatus.version) 已安装"
} else {
    Write-Host "    未检测到 Node.js 18+，开始安装..." -ForegroundColor Gray
    
    # Try winget first
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "使用 winget 安装..."
        winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        $nodeStatus = Test-NodeInstalled
        if ($nodeStatus.installed) {
            Write-Success "Node.js 安装完成"
        } else {
            Write-Host "    需要重启 PowerShell 后重新运行安装" -ForegroundColor Yellow
            exit 0
        }
    }
    # Try choco
    elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "使用 Chocolatey 安装..."
        choco install nodejs-lts -y
        Write-Success "Node.js 安装完成 (可能需要重启)"
    }
    # Manual fallback
    else {
        Write-Host ""
        Write-Error "未检测到包管理器 (winget/choco/scoop)"
        Write-Host ""
        Write-Host "请手动安装 Node.js:" -ForegroundColor Yellow
        Write-Host "  1. 访问 https://nodejs.org" -ForegroundColor Gray
        Write-Host "  2. 下载 LTS 版本 (推荐 v20 或 v22)" -ForegroundColor Gray
        Write-Host "  3. 运行安装程序" -ForegroundColor Gray
        Write-Host "  4. 重新运行此安装脚本" -ForegroundColor Gray
        Write-Host ""
        exit 1
    }
}

# ============== Step 3: Clone/Update Repository ==============
Write-Step "准备安装 Thatgfsj Code..."

$installDir = Join-Path $env:USERPROFILE "thatgfsj-code"

if (Test-Path $installDir) {
    Write-Info "检测到已有安装，正在更新..."
    if (-not $DryRun) {
        Set-Location $installDir
        git pull origin main 2>$null
        if ($LASTEXITCODE -ne 0) {
            # If pull fails, re-clone
            Remove-Item $installDir -Recurse -Force
        }
    }
} else {
    if (-not $DryRun) {
        Write-Info "正在克隆仓库..."
        git clone https://github.com/Thatgfsj/thatgfsj-code.git $installDir
        Set-Location $installDir
    }
}

if (-not (Test-Path (Join-Path $installDir "package.json"))) {
    Write-Error "安装目录无效: $installDir"
    exit 1
}

Write-Success "代码准备完成: $installDir"

# ============== Step 4: Install Dependencies ==============
Write-Step "安装依赖..."

if (-not $DryRun) {
    Set-Location $installDir
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install 失败"
        exit 1
    }
    
    Write-Info "编译 TypeScript..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "编译失败"
        exit 1
    }
}
Write-Success "依赖安装完成"

# ============== Step 5: Link Command ==============
Write-Step "设置命令..."

if (-not $DryRun) {
    npm link
}
Write-Success "命令 'gfcode' 已可用"

# ============== Step 6: Setup API Key ==============
Write-Host ""
Write-Step "配置 API Key (可选)..."

$apiKeySet = $false
$providers = @{
    "1" = @{name="SiliconFlow (推荐)"; var="SILICONFLOW_API_KEY"; url="https://siliconflow.cn"}
    "2" = @{name="MiniMax"; var="MINIMAX_API_KEY"; url="https://platform.minimax.io"}
    "3" = @{name="OpenAI"; var="OPENAI_API_KEY"; url="https://platform.openai.com"}
    "4" = @{name="Anthropic"; var="ANTHROPIC_API_KEY"; url="https://www.anthropic.com"}
    "5" = @{name="Google Gemini"; var="GEMINI_API_KEY"; url="https://aistudio.google.com/app/apikey"}
    "6" = @{name="跳过 (稍后配置)"; var=""; url=""}
}

Write-Host ""
Write-Host "    选择 AI Provider:" -ForegroundColor White
Write-Host ""
foreach ($key in $providers.Keys | Sort-Object) {
    $p = $providers[$key]
    Write-Host "    $key. $($p.name)" -ForegroundColor Gray
}
Write-Host ""

if ($NoOpen) {
    Write-Host "    使用 --NoOpen 跳过配置" -ForegroundColor Gray
} else {
    $choice = Read-Host "    请选择 (1-6, 直接回车跳过)"
    
    if ($choice -and $providers.ContainsKey($choice)) {
        $selected = $providers[$choice]
        if ($selected.var) {
            Write-Host ""
            Write-Host "    访问 $($selected.url) 获取 API Key" -ForegroundColor Cyan
            Write-Host "    获取后粘贴到下方" -ForegroundColor Gray
            Write-Host ""
            
            $key = Read-Host "    请输入 API Key (输入后回车)"
            
            if ($key) {
                # Save to config file
                $configDir = Join-Path $env:USERPROFILE ".thatgfsj"
                if (-not (Test-Path $configDir)) {
                    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
                }
                
                $configFile = Join-Path $configDir "config.json"
                $config = @{
                    model = "Qwen/Qwen2.5-7B-Instruct"
                    apiKey = $key
                    provider = "siliconflow"
                    temperature = 0.7
                    maxTokens = 4096
                }
                
                # Set provider-specific defaults
                switch ($choice) {
                    "1" { $config.provider = "siliconflow"; $config.model = "Qwen/Qwen2.5-7B-Instruct" }
                    "2" { $config.provider = "minimax"; $config.model = "MiniMax-M2.5" }
                    "3" { $config.provider = "openai"; $config.model = "gpt-4o-mini" }
                    "4" { $config.provider = "anthropic"; $config.model = "claude-3-haiku-20240307" }
                    "5" { $config.provider = "gemini"; $config.model = "gemini-1.5-flash-8b" }
                }
                
                $config | ConvertTo-Json | Set-Content $configFile -Encoding UTF8
                Write-Success "配置已保存到: $configFile"
            }
        }
    }
}

# ============== Done ==============
Write-Host ""
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Success "  安装完成!"
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  使用方法:" -ForegroundColor White
Write-Host "    gfcode init          - 重新配置" -ForegroundColor Gray
Write-Host "    gfcode               - 启动交互模式" -ForegroundColor Gray
Write-Host "    gfcode '你的问题'    - 直接提问" -ForegroundColor Gray
Write-Host "    gfcode explain '代码' - 解释代码" -ForegroundColor Gray
Write-Host "    gfcode debug '代码'   - 调试代码" -ForegroundColor Gray
Write-Host ""
Write-Host "  文档: https://github.com/Thatgfsj/thatgfsj-code" -ForegroundColor Gray
Write-Host ""
