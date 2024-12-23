# Minecraft Spot Server

## Example .env file

```bash
# SSH key name
EC2_KEY_NAME=minecraft

# Maximum spot price
SPOT_PRICE=0.05

# Your IP
SSH_SOURCE_CIDR=0.0.0.0/32

# Enable automatic EFS backups
EFS_BACKUPS=false

# Enable scheduled S3 backups
S3_BACKUPS=true

# Minecraft server docker image tag for itzg/minecraft-server
IMAGE_TAG=latest

# EC2 instance type
INSTANCE_TYPE=t4g.medium

# Minecraft server port
SERVER_PORT=25565

# RCON port
RCON_PORT=25575

# RCON password
RCON_PASSWORD=<SECURE PASSWORD>
```

## Example .env.container file

See all options in [the image documentation](https://docker-minecraft-server.readthedocs.io/en/latest/variables/).

```bash
# Must be set
EULA=true

TYPE=PAPER
VERSION=1.21.3
MOTD="A Minecraft Server"
MAX_MEMORY=2G
```
