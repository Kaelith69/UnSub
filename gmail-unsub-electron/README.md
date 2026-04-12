# Gmail Unsubscriber

<p align="center">
  <img src="./assets/banner.svg" alt="Gmail Unsubscriber Banner" width="100%" />
</p>

> Clean your inbox deterministically, locally, and at scale

---

## Project Overview

Inbox overload is exponential. This tool provides a **deterministic, privacy first unsubscribe workflow** without external data exposure.

---

## Features

- OAuth authentication  
- Incremental inbox scan  
- Header based subscription detection  
- Sender grouping  
- Batched unsubscribe execution  
- Local only processing  

---

## Architecture

```mermaid
flowchart LR
   UI --> IPC
   IPC --> AUTH
   IPC --> SCAN
   AUTH --> GAPI
   SCAN --> GAPI
   SCAN --> EXEC
   EXEC --> GAPI
   EXEC --> HTTP
```

---

## Setup

```bash
git clone https://github.com/Kaelith69/UnSub.git
cd UnSub
npm install
cp .env.example .env
npm run dev
```

---

## License

MIT