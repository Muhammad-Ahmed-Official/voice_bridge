import { Router } from "express";
import { createHistory, getHistoryByUser, deleteHistory } from "../controllers/history.controller.js";

const historyRouter = Router();
historyRouter.route("/create").post(createHistory);
historyRouter.route("/user/:userId").get(getHistoryByUser);
historyRouter.route("/:historyId").delete(deleteHistory);

export default historyRouter;