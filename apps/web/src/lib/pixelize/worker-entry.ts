import { installWorker, type WorkerScope } from "./worker";

installWorker(self as unknown as WorkerScope);
