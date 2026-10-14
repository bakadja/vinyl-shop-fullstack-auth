import { asyncHandler } from '../middleware/asyncHandler.js'
import express from 'express'
import { getGenres, getProducts } from '../controllers/productsController.js'

export const productsRouter = express.Router()

productsRouter.get('/genres', asyncHandler(getGenres))
productsRouter.get('/', asyncHandler(getProducts))
