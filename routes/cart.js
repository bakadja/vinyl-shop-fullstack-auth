import { asyncHandler } from '../middleware/asyncHandler.js'
import express from 'express'
import {
  addToCart,
  getCartCount,
  getAll,
  deleteItem,
  deleteAll } from '../controllers/cartController.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const cartRouter = express.Router()

cartRouter.post('/add', requireAuth, asyncHandler(addToCart))
cartRouter.get('/cart-count', requireAuth, asyncHandler(getCartCount))
cartRouter.get('/', requireAuth, asyncHandler(getAll))
cartRouter.delete('/all', requireAuth, asyncHandler(deleteAll))
cartRouter.delete('/:itemId', requireAuth, asyncHandler(deleteItem))
